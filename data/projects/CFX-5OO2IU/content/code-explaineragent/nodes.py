from config import llm
from prompt import PROMPT

def explain_code(state):
    prompt = PROMPT.format(code=state["code"])

    response = llm.invoke(prompt)

    return {
        "explanation": response.content
    }