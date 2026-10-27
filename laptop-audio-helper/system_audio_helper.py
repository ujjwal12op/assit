from __future__ import annotations

import base64
import json
import math
import queue
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
from collections import deque
from dataclasses import dataclass
from tkinter import BOTH, END, LEFT, StringVar, Tk, messagebox
from tkinter import ttk

import numpy as np
import soundcard as sc


SAMPLE_RATE = 48_000
TRANSCRIBE_RATE = 16_000
BLOCK_FRAMES = 12_000  # 250 ms: fast level updates without tiny network chunks.
SPEECH_RMS_THRESHOLD = 0.0018
SILENCE_END_SECONDS = 0.9
MAX_SEGMENT_SECONDS = 20
MAX_AUDIO_BASE64 = 2_800_000


@dataclass(frozen=True)
class LoopbackDevice:
    name: str
    device_id: str
    channels: int

    @property
    def label(self) -> str:
        return self.name


def list_loopback_devices() -> list[LoopbackDevice]:
    devices = []
    for mic in sc.all_microphones(include_loopback=True):
        if not getattr(mic, 'isloopback', False) or getattr(mic, 'channels', 0) < 2:
            continue
        devices.append(LoopbackDevice(mic.name, mic.id, mic.channels))
    return devices


def encode_wav(samples: np.ndarray, source_rate: int = SAMPLE_RATE) -> bytes:
    """Downmix stereo only after capture, then resample to compact 16 kHz WAV."""
    audio = np.asarray(samples, dtype=np.float32)
    if audio.ndim == 2:
        audio = audio.mean(axis=1, dtype=np.float32)
    if audio.ndim != 1 or audio.size == 0:
        raise ValueError('The captured audio segment was empty.')
    target_count = max(1, round(audio.size * TRANSCRIBE_RATE / source_rate))
    if target_count != audio.size:
        old_positions = np.arange(audio.size, dtype=np.float32)
        new_positions = np.arange(target_count, dtype=np.float32) * (source_rate / TRANSCRIBE_RATE)
        audio = np.interp(new_positions, old_positions, audio).astype(np.float32)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype('<i2')
    from io import BytesIO

    output = BytesIO()
    with wave.open(output, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(TRANSCRIBE_RATE)
        wav.writeframes(pcm.tobytes())
    return output.getvalue()


def rms_level(samples: np.ndarray) -> float:
    audio = np.asarray(samples, dtype=np.float64)
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(audio))))


class AppApi:
    def __init__(self, app_url: str):
        parsed = urllib.parse.urlparse(app_url.strip())
        local_http = parsed.scheme == 'http' and parsed.hostname in {'localhost', '127.0.0.1'}
        if parsed.scheme != 'https' and not local_http:
            raise ValueError('Use the app’s HTTPS address. HTTP is allowed only for localhost testing.')
        if not parsed.netloc or parsed.username or parsed.password:
            raise ValueError('Enter a valid app address without a username or password.')
        self.base = parsed.scheme + '://' + parsed.netloc
        self.cookies = urllib.request.HTTPCookieProcessor()
        self.opener = urllib.request.build_opener(self.cookies)

    def _request(self, path: str, data: dict | None = None) -> dict:
        url = self.base + path
        body = json.dumps(data).encode('utf-8') if data is not None else None
        headers = {'content-type': 'application/json'} if data is not None else {}
        request = urllib.request.Request(url, data=body, headers=headers, method='POST' if data is not None else 'GET')
        try:
            with self.opener.open(request, timeout=15) as response:
                return json.loads(response.read().decode('utf-8'))
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read().decode('utf-8')).get('error')
            except Exception:
                detail = ''
            raise RuntimeError(detail or f'Server returned HTTP {error.code}.') from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise RuntimeError('Could not reach the app server. Check the address and internet connection.') from error

    def sign_in(self, password: str) -> None:
        session = self._request('/api/session')
        if session.get('protected') and not session.get('authenticated'):
            self._request('/api/login', {'password': password})

    def join(self, code: str) -> str:
        result = self._request('/api/interviewer-audio-pair', {'action': 'join', 'code': code})
        if not result.get('connected') or not result.get('id'):
            raise RuntimeError('The server did not complete the phone pairing.')
        return result['id']

    def upload(self, pair_id: str, audio: bytes) -> None:
        encoded = base64.b64encode(audio).decode('ascii')
        if len(encoded) > MAX_AUDIO_BASE64:
            raise RuntimeError('Audio segment exceeded the server size limit; shorten the segment and retry.')
        self._request('/api/interviewer-audio-pair', {
            'action': 'upload', 'id': pair_id,
            'audioData': encoded, 'audioMimeType': 'audio/wav'
        })

    def stop_pair(self, pair_id: str) -> None:
        try:
            self._request('/api/interviewer-audio-pair', {'action': 'stop', 'id': pair_id, 'role': 'laptop'})
        except Exception:
            pass
        try:
            self._request('/api/logout', {})
        except Exception:
            pass


class SystemAudioHelper:
    def __init__(self, root: Tk):
        self.root = root
        self.root.title('Interview Copilot · Laptop Audio')
        self.root.geometry('620x520')
        self.root.minsize(560, 480)
        self.root.protocol('WM_DELETE_WINDOW', self.close)

        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.uploads: queue.Queue[bytes] = queue.Queue(maxsize=8)
        self.stop_event = threading.Event()
        self.capture_done = threading.Event()
        self.worker_error = threading.Event()
        self.capture_thread: threading.Thread | None = None
        self.upload_thread: threading.Thread | None = None
        self.api: AppApi | None = None
        self.pair_id = ''
        self.device_map: dict[str, LoopbackDevice] = {}

        self.url_var = StringVar()
        self.password_var = StringVar()
        self.code_var = StringVar()
        self.device_var = StringVar()
        self.status_var = StringVar(value='Enter your app address and phone pairing code to connect.')
        self.level_var = StringVar(value='Playback level: waiting')

        self._build_ui()
        self.refresh_devices()
        self.root.after(100, self._drain_events)

    def _build_ui(self) -> None:
        outer = ttk.Frame(self.root, padding=24)
        outer.pack(fill=BOTH, expand=True)
        ttk.Label(outer, text='✳  Interview Copilot', font=('Segoe UI', 11, 'bold'), foreground='#315d4b').pack(anchor='w')
        ttk.Label(outer, text='Windows system audio', font=('Segoe UI', 22, 'bold')).pack(anchor='w', pady=(12, 2))
        ttk.Label(outer, text='Capture laptop playback directly, including audio sent to headphones.', wraplength=550).pack(anchor='w', pady=(0, 16))

        self._field(outer, 'APP ADDRESS', self.url_var, 'https://your-app.onrender.com')
        self._field(outer, 'APP PASSWORD', self.password_var, 'Your shared app password', show='•')
        self._field(outer, 'PHONE PAIRING CODE', self.code_var, 'Six-character code from Interview Room')

        device_row = ttk.Frame(outer)
        device_row.pack(fill='x', pady=(0, 13))
        ttk.Label(device_row, text='WINDOWS OUTPUT DEVICE', font=('Segoe UI', 9, 'bold')).pack(anchor='w', pady=(0, 5))
        controls = ttk.Frame(device_row)
        controls.pack(fill='x')
        self.device_combo = ttk.Combobox(controls, textvariable=self.device_var, state='readonly')
        self.device_combo.pack(side=LEFT, fill='x', expand=True)
        ttk.Button(controls, text='Refresh', command=self.refresh_devices).pack(side=LEFT, padx=(8, 0))

        buttons = ttk.Frame(outer)
        buttons.pack(fill='x', pady=(2, 12))
        self.connect_button = ttk.Button(buttons, text='Connect and start capture', command=self.connect)
        self.connect_button.pack(side=LEFT, fill='x', expand=True)
        self.stop_button = ttk.Button(buttons, text='Stop', command=self.stop, state='disabled')
        self.stop_button.pack(side=LEFT, padx=(8, 0))

        ttk.Separator(outer).pack(fill='x', pady=(5, 12))
        ttk.Label(outer, textvariable=self.status_var, wraplength=550).pack(anchor='w')
        ttk.Label(outer, textvariable=self.level_var, font=('Segoe UI', 9)).pack(anchor='w', pady=(9, 2))
        ttk.Label(outer, text='Only short speech segments are sent over HTTPS to the app. Audio is not saved to disk. The app password is kept in memory only.', wraplength=550, foreground='#65736a').pack(anchor='w', side='bottom', pady=(17, 0))

    @staticmethod
    def _field(parent, label: str, variable: StringVar, placeholder: str, show: str = '') -> None:
        frame = ttk.Frame(parent)
        frame.pack(fill='x', pady=(0, 10))
        ttk.Label(frame, text=label, font=('Segoe UI', 9, 'bold')).pack(anchor='w', pady=(0, 5))
        ttk.Entry(frame, textvariable=variable, show=show).pack(fill='x')

    def refresh_devices(self) -> None:
        try:
            devices = list_loopback_devices()
            self.device_map = {f'{item.name} ({item.channels} channels)': item for item in devices}
            labels = list(self.device_map)
            self.device_combo['values'] = labels
            default_name = sc.default_speaker().name
            selected = next((label for label, item in self.device_map.items() if item.name == default_name), labels[0] if labels else '')
            self.device_var.set(selected)
            if not labels:
                self.status_var.set('No stereo Windows playback loopback device was found. Connect/select an output device, then press Refresh.')
        except Exception as error:
            self.status_var.set(f'Could not list Windows audio outputs: {error}')

    def connect(self) -> None:
        if self.capture_thread and self.capture_thread.is_alive():
            return
        code = self.code_var.get().strip().upper()
        if not re.fullmatch(r'[A-F0-9]{6}', code):
            messagebox.showerror('Pairing code needed', 'Enter the six-character code shown in the phone Interview Room.')
            return
        device = self.device_map.get(self.device_var.get())
        if not device:
            messagebox.showerror('Output device needed', 'Choose a Windows output device, then try again.')
            return
        self.connect_button.configure(state='disabled')
        self.stop_button.configure(state='disabled')
        self.status_var.set('Signing in and pairing with your phone…')
        app_url = self.url_var.get().strip()
        password = self.password_var.get()
        threading.Thread(target=self._connect_worker, args=(code, device, app_url, password), daemon=True).start()

    def _connect_worker(self, code: str, device: LoopbackDevice, app_url: str, password: str) -> None:
        api = None
        pair_id = ''
        try:
            api = AppApi(app_url)
            api.sign_in(password)
            pair_id = api.join(code)
            self.api = api
            self.pair_id = pair_id
            self.events.put(('clear-password', None))
            self.events.put(('status', f'Paired · capturing {device.name}. Start or continue interviewer playback.'))
            self.stop_event.clear()
            self.capture_done.clear()
            self.worker_error.clear()
            self.uploads = queue.Queue(maxsize=8)
            self.upload_thread = threading.Thread(target=self._upload_worker, daemon=True)
            self.capture_thread = threading.Thread(target=self._capture_worker, args=(device,), daemon=True)
            self.upload_thread.start()
            self.capture_thread.start()
            self.events.put(('buttons', True))
        except Exception as error:
            if api and pair_id:
                api.stop_pair(pair_id)
            self.events.put(('status', str(error)))
            self.events.put(('buttons', False))

    def _capture_worker(self, device: LoopbackDevice) -> None:
        try:
            microphone = sc.get_microphone(device.device_id, include_loopback=True)
            preroll: deque[np.ndarray] = deque(maxlen=2)
            segment: list[np.ndarray] = []
            segment_frames = 0
            active = False
            last_voice = 0.0
            with microphone.recorder(samplerate=SAMPLE_RATE, channels=[0, 1], blocksize=SAMPLE_RATE) as recorder:
                self.events.put(('status', f'Connected · listening to {device.name} playback.'))
                while not self.stop_event.is_set() and not self.worker_error.is_set():
                    block = np.asarray(recorder.record(numframes=BLOCK_FRAMES), dtype=np.float32)
                    if block.ndim != 2 or block.shape[0] == 0:
                        continue
                    level = rms_level(block)
                    self.events.put(('level', level))
                    now = time.monotonic()
                    if not active and level >= SPEECH_RMS_THRESHOLD:
                        active = True
                        segment = list(preroll)
                        segment_frames = sum(part.shape[0] for part in segment)
                        last_voice = now
                    if active:
                        segment.append(block.copy())
                        segment_frames += block.shape[0]
                        if level >= SPEECH_RMS_THRESHOLD:
                            last_voice = now
                        duration = segment_frames / SAMPLE_RATE
                        if now - last_voice >= SILENCE_END_SECONDS or duration >= MAX_SEGMENT_SECONDS:
                            self._queue_segment(segment)
                            active = False
                            segment = []
                            segment_frames = 0
                            preroll.clear()
                    else:
                        preroll.append(block.copy())
            if segment and not self.worker_error.is_set():
                self._queue_segment(segment)
        except Exception as error:
            self.events.put(('status', f'Playback capture stopped: {error}'))
            self.stop_event.set()
        finally:
            self.capture_done.set()

    def _queue_segment(self, blocks: list[np.ndarray]) -> None:
        if not blocks:
            return
        try:
            audio = encode_wav(np.concatenate(blocks, axis=0), SAMPLE_RATE)
            self.uploads.put(audio, timeout=3)
            self.events.put(('status', 'Speech captured · sending to the phone for transcription…'))
        except queue.Full:
            self.worker_error.set()
            self.stop_event.set()
            self.events.put(('status', 'The phone/server is too far behind. Capture stopped to avoid silently dropping more speech.'))
        except Exception as error:
            self.worker_error.set()
            self.stop_event.set()
            self.events.put(('status', f'Could not prepare the captured audio: {error}'))

    def _upload_worker(self) -> None:
        try:
            while not self.capture_done.is_set() or not self.uploads.empty():
                try:
                    audio = self.uploads.get(timeout=0.25)
                except queue.Empty:
                    continue
                if not self.api or not self.pair_id:
                    raise RuntimeError('The phone pairing was lost.')
                last_error = None
                for attempt in range(3):
                    try:
                        self.api.upload(self.pair_id, audio)
                        last_error = None
                        break
                    except Exception as error:
                        last_error = error
                        if attempt < 2:
                            time.sleep(0.35 * (attempt + 1))
                self.uploads.task_done()
                if last_error:
                    raise RuntimeError(f'Could not deliver an audio segment: {last_error}')
                self.events.put(('status', 'Connected · audio delivered to the phone transcription pipeline.'))
        except Exception as error:
            self.worker_error.set()
            self.stop_event.set()
            self.events.put(('status', str(error)))
            while True:
                try:
                    self.uploads.get_nowait()
                    self.uploads.task_done()
                except queue.Empty:
                    break
        finally:
            if self.api and self.pair_id:
                self.api.stop_pair(self.pair_id)
            self.events.put(('stopped', None))

    def stop(self) -> None:
        if not self.capture_thread or not self.capture_thread.is_alive():
            return
        self.stop_button.configure(state='disabled')
        self.status_var.set('Stopping capture and delivering the last audio segment…')
        self.stop_event.set()

    def _drain_events(self) -> None:
        try:
            while True:
                kind, value = self.events.get_nowait()
                if kind == 'status':
                    self.status_var.set(str(value))
                elif kind == 'level':
                    level = float(value)
                    self.level_var.set(f'Playback level: RMS {level:.4f} · ' + ('audio detected' if level >= SPEECH_RMS_THRESHOLD else 'quiet'))
                elif kind == 'buttons':
                    active = bool(value)
                    self.stop_button.configure(state='normal' if active else 'disabled')
                elif kind == 'clear-password':
                    self.password_var.set('')
                elif kind == 'stopped':
                    self.pair_id = ''
                    self.api = None
                    self.capture_thread = None
                    self.upload_thread = None
                    self.connect_button.configure(state='normal')
                    self.stop_button.configure(state='disabled')
                    if self.status_var.get().startswith('Connected'):
                        self.status_var.set('Capture stopped. Create a new phone pairing code to reconnect.')
        except queue.Empty:
            pass
        self.root.after(100, self._drain_events)

    def close(self) -> None:
        if self.pair_id:
            self.stop_event.set()
            self.root.after(500, self._wait_for_shutdown)
            return
        self.root.destroy()

    def _wait_for_shutdown(self) -> None:
        if self.upload_thread and self.upload_thread.is_alive():
            self.root.after(250, self._wait_for_shutdown)
        else:
            self.root.destroy()


def main() -> None:
    root = Tk()
    try:
        ttk.Style(root).theme_use('vista')
    except Exception:
        pass
    SystemAudioHelper(root)
    root.mainloop()


if __name__ == '__main__':
    main()
