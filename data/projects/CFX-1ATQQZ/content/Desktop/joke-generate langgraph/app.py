from typing import TypedDict
from dotenv import load_dotenv
from langgraph.graph import StateGraph, START, END
from langchain_openai import ChatOpenAI
import os

# Load .env relative to app.py location
env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path=env_path)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
if not OPENROUTER_API_KEY:
    try:
        OPENROUTER_API_KEY = input("Enter OPENROUTER_API_KEY: ").strip()
    except EOFError:
        OPENROUTER_API_KEY = ""

# OpenRouter Model
# Note: some free slugs may be unavailable; if that happens, set the model to a paid-available slug.
llm = ChatOpenAI(
    model=os.getenv("OPENROUTER_MODEL", "google/gemma-3-12b-it"),
    api_key=OPENROUTER_API_KEY,
    base_url="https://openrouter.ai/api/v1",
)

# State
class State(TypedDict):
    topic: str
    joke: str

# Node
def generate_joke(state):
    response = llm.invoke(
        f"Tell me a short funny joke about {state['topic']}"
    )

    return {
        "joke": response.content
    }

# Graph
graph = StateGraph(State)

graph.add_node("joke_generator", generate_joke)

graph.add_edge(START, "joke_generator")
graph.add_edge("joke_generator", END)

# Compile
app = graph.compile()

# Input
try:
    topic = input("Enter topic: ")
except EOFError:
    topic = "coding"

# Run
result = app.invoke({"topic": topic})

print("\n😂 Joke:")
print(result["joke"])