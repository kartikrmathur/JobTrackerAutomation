# Job Tracker Automation - Sync Script
import pandas as pd
import os
import time
import glob

# 🔧 CHANGE THIS (your system username)
DOWNLOADS_PATH = "C:/Users/Lenovo/Downloads/"

# 📄 Exported CSV files from the extension (handles job_tracker_2025-01-01.csv, etc.)
CSV_PATTERN = os.path.join(DOWNLOADS_PATH, "job_tracker*.csv")

# 📊 Your main Excel file
EXCEL_FILE = r"D:\01. SelfBuilding [Personal]\01. Life\01. Job Hunting\04. Tracker And Analysis\JobTracker.xlsx"

# 🧠 Column structure (must match your Excel)
COLUMNS = [
    "Date of Apply",
    "Organization",
    "Salary",
    "Location",
    "Role",
    "Year of experience",
    "Submission Status",
    "Portal",
    "URL",
    "Referred by",
    "Result"
]

def process_files():
    files = glob.glob(CSV_PATTERN)

    if not files:
        return

    all_new_data = []

    for file in files:
        try:
            if os.path.getsize(file) == 0:
                continue

            df = pd.read_csv(file)

            all_new_data.append(df)

        except Exception as e:
            print(f"Error reading {file}: {e}")

    if not all_new_data:
        return

    new_data = pd.concat(all_new_data, ignore_index=True)

    try:
        if os.path.exists(EXCEL_FILE):
            existing = pd.read_excel(EXCEL_FILE)

            # 🔥 Remove duplicates based on URL (optional but recommended)
            if "URL" in existing.columns and "URL" in new_data.columns:
                combined = pd.concat([existing, new_data]).drop_duplicates(subset=["URL"])
            else:
                combined = pd.concat([existing, new_data], ignore_index=True)
        else:
            combined = new_data

        combined.to_excel(EXCEL_FILE, index=False)

        print(f"Added {len(new_data)} new entries ✅")

        # 🔥 CLEANUP (delete processed files)
        for file in files:
            os.remove(file)

    except Exception as e:
        print("Error writing to Excel:", e)


if __name__ == "__main__":
    print("🚀 Sync Script Running...")
    while True:
        process_files()
        time.sleep(5)  # check every 5 seconds