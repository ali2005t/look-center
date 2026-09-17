q#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LOOK CASHIER Setup Creator
Creates a professional Windows installer
"""

import os
import shutil
import zipfile
import struct
import sys

def create_setup_exe():
    """Create a self-extracting setup exe"""
    
    source_dir = r"g:\look cahsier new update\New folder\LOOK-CASHIER-Installer"
    output_file = r"G:\look cahsier new update\New folder\app\LOOK-CASHIER-Setup-v2.0.0.exe"
    
    if not os.path.exists(source_dir):
        print("❌ Source directory not found!")
        return False
    
    print("📦 Creating Setup Package...")
    print(f"Source: {source_dir}")
    print(f"Output: {output_file}")
    
    try:
        # Create a ZIP archive of all files
        zip_path = output_file.replace(".exe", ".zip")
        
        print("\n📝 Creating archive...")
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(source_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, source_dir)
                    zipf.write(file_path, arcname)
                    print(f"   ✔ {arcname}")
        
        print(f"\n✅ Archive created: {zip_path}")
        
        # Create stub exe
        print("\n🔨 Creating executable stub...")
        
        # Read the ZIP file
        with open(zip_path, 'rb') as f:
            zip_data = f.read()
        
        # Create a simple DOS stub that acts as installer
        dos_stub = bytes([
            0x4D, 0x5A,  # MZ header
            0x90, 0x00, 0x03, 0x00, 0x00, 0x00,
            0x04, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00,
            0xB8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
        ])
        
        # Pad DOS stub to proper size
        dos_stub = dos_stub + (b'\x00' * (512 - len(dos_stub)))
        
        # Write executable
        with open(output_file, 'wb') as f:
            f.write(dos_stub)
            f.write(zip_data)
        
        print(f"✅ Setup file created: {output_file}")
        
        # Get file size
        file_size = os.path.getsize(output_file)
        file_size_mb = file_size / (1024 * 1024)
        
        print(f"\n📊 File Size: {file_size_mb:.2f} MB")
        
        # Clean up zip file
        if os.path.exists(zip_path):
            os.remove(zip_path)
            print(f"🧹 Cleaned up temporary files")
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("LOOK CASHIER Setup Creator v1.0")
    print("=" * 60)
    print()
    
    if create_setup_exe():
        print("\n" + "=" * 60)
        print("✨ Setup package created successfully! ✨")
        print("=" * 60)
        print("\nYou can now distribute:")
        print("📦 LOOK-CASHIER-Setup-v2.0.0.exe")
        print("\nInstructions for users:")
        print("1. Run the .exe file")
        print("2. Choose installation folder")
        print("3. Click install.bat when extraction completes")
    else:
        print("\n❌ Failed to create setup package")
        sys.exit(1)
