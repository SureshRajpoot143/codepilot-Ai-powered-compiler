from graph import graph

print("=" * 50)
print("        CODE EXPLAINER AGENT")
print("=" * 50)

code = input("\nPaste your code:\n\n")

result = graph.invoke({
    "code": code
})

print("\n")
print("=" * 50)
print("EXPLANATION")
print("=" * 50)

print(result["explanation"])