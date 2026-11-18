def factorial_loop(n):
    if n < 0:
        return "Factorial does not exist for negative numbers"
    result = 1
    for i in range(1, n + 1):
        result *= i
    return result

print(factorial_loop(5))  # Output: 120
