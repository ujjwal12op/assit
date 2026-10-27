import io
import unittest
import wave

import numpy as np

from system_audio_helper import AppApi, TRANSCRIBE_RATE, encode_wav, rms_level


class AudioEncodingTests(unittest.TestCase):
    def test_stereo_capture_becomes_mono_16khz_pcm_wav(self):
        time = np.arange(48_000, dtype=np.float32) / 48_000
        left = 0.3 * np.sin(2 * np.pi * 440 * time)
        right = 0.3 * np.sin(2 * np.pi * 660 * time)
        wav_bytes = encode_wav(np.column_stack((left, right)), 48_000)
        with wave.open(io.BytesIO(wav_bytes), 'rb') as recording:
            self.assertEqual(recording.getnchannels(), 1)
            self.assertEqual(recording.getframerate(), TRANSCRIBE_RATE)
            self.assertEqual(recording.getsampwidth(), 2)
            self.assertEqual(recording.getnframes(), TRANSCRIBE_RATE)

    def test_silence_is_not_reported_as_audio_activity(self):
        self.assertEqual(rms_level(np.zeros((12000, 2), dtype=np.float32)), 0.0)

    def test_wav_segment_fits_existing_relay_limit(self):
        samples = np.zeros((48_000 * 20, 2), dtype=np.float32)
        wav_bytes = encode_wav(samples, 48_000)
        self.assertLess(len(wav_bytes) * 4 // 3 + 8, 2_800_000)


class AppAddressTests(unittest.TestCase):
    def test_requires_tls_except_for_local_development(self):
        self.assertEqual(AppApi('https://example.com/app').base, 'https://example.com')
        self.assertEqual(AppApi('http://localhost:3000').base, 'http://localhost:3000')
        with self.assertRaises(ValueError):
            AppApi('http://example.com')

    def test_rejects_embedded_credentials(self):
        with self.assertRaises(ValueError):
            AppApi('https://user:password@example.com')


if __name__ == '__main__':
    unittest.main()
