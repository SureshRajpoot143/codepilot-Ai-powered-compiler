class TreeNode:
    def __init__(self, value):
        self.value = value
        self.children = []

    def add_child(self, child_node):
        raise NotImplementedError("TODO: implement adding a child node")

    def __str__(self):
        raise NotImplementedError("TODO: implement string representation")

# Example usage:
root = TreeNode(1)
child = TreeNode(2)
root.add_child(child)
print(root)