#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== Building FGTech Travel Expense Android APK ==="

SDK_ROOT="/home/nothing/Android/Sdk"
BUILD_TOOLS="$SDK_ROOT/build-tools/34.0.0"
ANDROID_JAR="$SDK_ROOT/platforms/android-34/android.jar"

rm -rf build
mkdir -p build/gen build/obj build/bin

echo "[1/7] Compiling Android Resources..."
"$BUILD_TOOLS/aapt2" compile --dir res -o build/compiled_res.zip

echo "[2/7] Linking Resources and Manifest..."
"$BUILD_TOOLS/aapt2" link -I "$ANDROID_JAR" build/compiled_res.zip --manifest AndroidManifest.xml -o build/unaligned.apk --java build/gen

echo "[3/7] Compiling Java Sources..."
javac --release 8 -cp "$ANDROID_JAR" -d build/obj build/gen/com/fgtech/travelexpense/R.java src/com/fgtech/travelexpense/*.java

echo "[4/7] Generating Dalvik Executable (DEX)..."
"$BUILD_TOOLS/d8" --lib "$ANDROID_JAR" --release --output build/bin build/obj/com/fgtech/travelexpense/*.class

echo "[5/7] Packaging DEX into APK..."
(cd build/bin && zip -u ../unaligned.apk classes.dex)

echo "[6/7] Aligning APK (4-byte boundary)..."
"$BUILD_TOOLS/zipalign" -f -v -p 4 build/unaligned.apk build/FGTech-Expense-aligned.apk > /dev/null

echo "[7/7] Signing APK with Release Key..."
if [ ! -f "keystore.jks" ]; then
    keytool -genkeypair -v -keystore keystore.jks \
        -alias fgtech \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -storepass fgtech2026 \
        -keypass fgtech2026 \
        -dname "CN=FGTech, OU=TravelExpense, O=FGTech, L=Mumbai, ST=Maharashtra, C=IN"
fi

"$BUILD_TOOLS/apksigner" sign \
    --ks keystore.jks \
    --ks-pass pass:fgtech2026 \
    --key-pass pass:fgtech2026 \
    --out FGTech-TravelExpense.apk \
    build/FGTech-Expense-aligned.apk

echo "=== Verification ==="
"$BUILD_TOOLS/apksigner" verify FGTech-TravelExpense.apk

cp FGTech-TravelExpense.apk ../FGTech-TravelExpense.apk
mkdir -p ../web && cp FGTech-TravelExpense.apk ../web/app-release.apk

echo ""
echo "SUCCESS! Android APK built successfully at:"
echo "$DIR/FGTech-TravelExpense.apk"
echo "Root copy: $DIR/../FGTech-TravelExpense.apk"
ls -lh "$DIR/FGTech-TravelExpense.apk"

