import random
import string

def generate_password(length):
    if length < 4:
        print("Password length should be at least 4.")
        return None

    # Create a pool of characters
    lowercase = string.ascii_lowercase
    uppercase = string.ascii_uppercase
    digits = string.digits
    special_characters = string.punctuation

    # Ensure the password contains at least one of each character type
    password = [
        random.choice(lowercase),
        random.choice(uppercase),
        random.choice(digits),
        random.choice(special_characters)
    ]

    # Fill the rest of the password length with random choices from all character types
    all_characters = lowercase + uppercase + digits + special_characters
    password += random.choices(all_characters, k=length - 4)

    # Shuffle the password list to ensure randomness
    random.shuffle(password)

    return ''.join(password)

# Example usage
password_length = int(input("Enter the desired password length (minimum 4): "))
generated_password = generate_password(password_length)
if generated_password:
    print("Generated password:", generated_password)