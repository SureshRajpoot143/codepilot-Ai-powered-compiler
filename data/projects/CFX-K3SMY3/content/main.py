import unittest
import string
from main import generate_strong_password  # Adjust import based on your file structure

class TestGenerateStrongPassword(unittest.TestCase):

    def test_normal_case_length_16(self):
        password = generate_strong_password(16)
        self.assertEqual(len(password), 16)
        self.assertTrue(any(c.islower() for c in password))
        self.assertTrue(any(c.isupper() for c in password))
        self.assertTrue(any(c.isdigit() for c in password))
        self.assertTrue(any(c in string.punctuation for c in password))

    def test_normal_case_length_20(self):
        password = generate_strong_password(20)
        self.assertEqual(len(password), 20)
        self.assertTrue(any(c.islower() for c in password))
        self.assertTrue(any(c.isupper() for c in password))
        self.assertTrue(any(c.isdigit() for c in password))
        self.assertTrue(any(c in string.punctuation for c in password))

    def test_edge_case_length_4(self):
        password = generate_strong_password(4)
        self.assertEqual(len(password), 4)
        self.assertTrue(any(c.islower() for c in password))
        self.assertTrue(any(c.isupper() for c in password))
        self.assertTrue(any(c.isdigit() for c in password))
        self.assertTrue(any(c in string.punctuation for c in password))

    def test_invalid_case_length_below_4(self):
        with self.assertRaises(ValueError):
            generate_strong_password(3)

    def test_invalid_case_non_integer_input(self):
        with self.assertRaises(TypeError):
            generate_strong_password("sixteen")

if __name__ == '__main__':
    unittest.main()