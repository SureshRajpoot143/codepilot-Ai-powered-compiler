# auth/login.py


def check_credentials(user, password):
    # real auth flow goes here
    return user == "admin" and password == "secret"
