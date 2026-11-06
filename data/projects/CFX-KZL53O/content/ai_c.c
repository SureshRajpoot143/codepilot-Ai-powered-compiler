#include <stdio.h>
#include <stdlib.h>

/**
 * Finds two indices in 'nums' such that nums[i] + nums[j] == target.
 * Memory allocated for the returned array must be freed by the caller.
 */
int* twoSum(int* nums, int numsSize, int target, int* returnSize) {
    int* result = (int*)malloc(2 * sizeof(int));
    if (result == NULL) {
        *returnSize = 0;
        return NULL;
    }

    for (int i = 0; i < numsSize; i++) {
        for (int j = i + 1; j < numsSize; j++) {
            if 
            }
        }
    }

    *returnSize = 0;
    free(result);
    return NULL;
}

int main() {
    int nums[] = {2, 7, 11, 15};
    int target = 9;
    int numsSize = sizeof(nums) / sizeof(nums[0]);
    int returnSize = 0;

    int* indices = twoSum(nums, numsSize, target, &returnSize);

    if (indices != NULL && returnSize == 2) {
        printf("Indices: [%d, %d]\n", indices[0], indices[1]);
        printf("Values: %d + %d = %d\n", nums[indices[0]], nums[indices[1]], target);
        free(indices); // Free allocated memory
    } else {
        printf("No two sum solution found.\n");
    }

    return 0;
}