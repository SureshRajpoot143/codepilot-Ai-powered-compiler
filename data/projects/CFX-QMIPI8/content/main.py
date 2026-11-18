# Function to calculate the sum of two digits
def sum_of_two_digits():
    # Prompt user for two digits
    digit1 = int(input("Enter the first digit (0-9): "))
    digit2 = int(input("Enter the second digit (0-9): "))
    
    # Check if the inputs are valid digits
    if 0 <= digit1 <= 9 and 0 <= digit2 <= 9:
        # Calculate the sum
        total = digit1 + digit2
        print(f"The sum of {digit1} and {digit2} is: {total}")
    else:
        print("Please enter valid digits between 0 and 9.")

# Call the function
sum_of_two_digits()