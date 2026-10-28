import math


def factorial_iterative(n):
    """Calculates factorial using an iterative approach."""
    if n < 0:
        raise ValueError("Factorial is not defined for negative numbers.")
    result = 1
    for i in range(1, n + 1):
        result *= i
    return result


def main():
    try:
        num = int(input("Enter a non-negative integer: "))

        # Using custom iterative function
        result_custom = factorial_iterative(num)
        print(f"Factorial of {num} (custom logic): {result_custom}")

        # Using built-in math module
        result_math = math.factorial(num)
        print(f"Factorial of {num} (math module):   {result_math}")

    except ValueError as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    main()