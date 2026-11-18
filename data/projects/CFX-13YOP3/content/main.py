def main():
    # Prompt user for two numbers
    try:
        num1 = float(input("Enter the first number: "))
        num2 = float(input("Enter the second number: "))
    except ValueError:
        print("Invalid input. Please enter valid numbers.")
        return

    # Perform basic calculations
    addition = num1 + num2
    subtraction = num1 - num2
    multiplication = num1 * num2
    division = num1 / num2 if num2 != 0 else "Cannot divide by zero"

    # Display the results
    print(f"\n--- Results for {num1} and {num2} ---")
    print(f"Sum (+):          {addition}")
    print(f"Difference (-):   {subtraction}")
    print(f"Product (*):      {multiplication}")
    print(f"Quotient (/):     {division}")

if __name__ == "__main__":
    main()