def is_palindrome(s):
    # Remove spaces and convert to lowercase
    cleaned = ''.join(s.split()).lower()
    # Check if the cleaned string is equal to its reverse
    return cleaned == cleaned[::-1]

# Example usage
input_string = "A man a plan a canal Panama"
if is_palindrome(input_string):
    print(f'"{input_string}" is a palindrome.')
else:
    print(f'"{input_string}" is not a palindrome.')def is_palindrome(s):
    # Remove spaces and convert to lowercase
    cleaned = ''.join(s.split()).lower()
    # Check if the cleaned string is equal to its reverse
    return cleaned == cleaned[::-1]

# Example usage
input_string = "A man a plan a canal Panama"
if is_palindrome(input_string):
    print(f'"{input_string}" is a palindrome.')
else:
    print(f'"{input_string}" is not a palindrome.')