import sys
import os
from markitdown import MarkItDown

def main():
    if len(sys.argv) < 2:
        print("Usage: python markitdown_bridge.py <file_path>")
        sys.exit(1)

    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(f"Error: File not found: {file_path}")
        sys.exit(1)

    try:
        md = MarkItDown()
        result = md.convert(file_path)
        print(result.text_content)
    except Exception as e:
        print(f"Error converting file: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
