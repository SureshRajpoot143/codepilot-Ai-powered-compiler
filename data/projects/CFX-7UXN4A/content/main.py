class VotingSystem:
    def __init__(self):
        self.candidates = {}
        self.votes = {}

    def add_candidate(self, name):
        if name not in self.candidates:
            self.candidates[name] = 0
            print(f"Candidate '{name}' added.")
        else:
            print(f"Candidate '{name}' already exists.")

    def vote(self, name):
        if name in self.candidates:
            self.candidates[name] += 1
            print(f"Vote cast for '{name}'.")
        else:
            print(f"Candidate '{name}' does not exist.")

    def display_results(self):
        print("\nVoting Results:")
        for candidate, votes in self.candidates.items():
            print(f"{candidate}: {votes} votes")

def main():
    voting_system = VotingSystem()
    
    # Adding candidates
    voting_system.add_candidate("Alice")
    voting_system.add_candidate("Bob")
    voting_system.add_candidate("Charlie")

    # Voting process
    while True:
        vote = input("Enter the name of the candidate you want to vote for (or 'exit' to finish): ")
        if vote.lower() == 'exit':
            break
        voting_system.vote(vote)

    # Display results
    voting_system.display_results()

if __name__ == "__main__":
    main()