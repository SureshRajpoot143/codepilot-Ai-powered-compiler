def two_sum(nums: list[int], target: int) -> list[int]:
    """Finds two indices in `nums` such that their values add up to `target`."""
    seen = {}  # Maps value -> index

    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i

    return []


# Example usage
if __name__ == "__main__":
    nums = [2, 7, 11, 15]
    target = 9

    result = two_sum(nums, target)
    print(f"Input: nums = {nums}, target = {target}")
    print(f"Output indices: {result}")
    print(f"Values: {nums[result[0]]} + {nums[result[1]]} = {target}")