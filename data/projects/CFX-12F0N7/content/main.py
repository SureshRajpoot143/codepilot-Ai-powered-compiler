def two_sum(nums: list[int], target: int) -> list[int]:
    """Finds indices of the two numbers in `nums` that add up to `target`."""
    seen = {}  # Maps number value to its index

    for current_index, num in enumerate(nums):
        complement = target - num
        # If the required complement is already in the hash map, return the indices
        if complement in seen:
            return [seen[complement], current_index]

        # Otherwise, store the current number's index
        seen[num] = current_index

    return []  # Return empty list if no pair is found


# Example Usage
if __name__ == "__main__":
    numbers = [2, 7, 11, 15]
    target_value = 9

    result = two_sum(numbers, target_value)

    if result:
        print(f"Indices: {result}")
        print(
            f"Values: {numbers[result[0]]} + {numbers[result[1]]} = {target_value}"
        )
    else:
        print("No two sum solution found.")