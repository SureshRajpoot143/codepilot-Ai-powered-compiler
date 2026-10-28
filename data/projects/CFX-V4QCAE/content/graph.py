from langgraph.graph import StateGraph, START, END

from state import AgentState
from nodes import explain_code

builder = StateGraph(AgentState)

builder.add_node("Code Explainer", explain_code)

builder.add_edge(START, "Code Explainer")
builder.add_edge("Code Explainer", END)

graph = builder.compile()