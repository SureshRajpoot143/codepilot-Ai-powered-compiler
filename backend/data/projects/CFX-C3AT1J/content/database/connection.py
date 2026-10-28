# database/connection.py


def connect(host="localhost", port=5432):
    # open a real connection here
    return {"host": host, "port": port, "connected": True}
