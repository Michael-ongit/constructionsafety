import torch

# Load the file
data = torch.load("your_file.pt", weights_only=True)

# 1. Check what type of data is inside (usually a dictionary or a model object)
print("Data type:", type(data))

# 2. If it's a state_dict (dictionary of weights), view the layer names
if isinstance(data, dict):
    print("\nModel Layers:")
    for key in data.keys():
        print(key)
        
    # View actual weights of a specific layer (e.g., the first layer)
    first_layer = list(data.keys())[0]
    print(f"\nWeights for {first_layer}:\n", data[first_layer])
else:
    # If the entire model object was saved
    print(data)
