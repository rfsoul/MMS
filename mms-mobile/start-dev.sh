#!/bin/bash
echo "Make sure your emulator is running first..."
adb wait-for-device
echo "Device ready. Setting up port forwarding..."
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3001 tcp:3001
echo "Starting Metro... press 'a' to open on Android"
npx expo start --clear
