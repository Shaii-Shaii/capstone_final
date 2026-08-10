const fs = require("fs");
const path = require("path");

// eslint-disable-next-line no-undef
const root = path.resolve(__dirname, "..");

function patchFile(relativePath, replacements) {
  const filePath = path.join(root, relativePath);

  if (!fs.existsSync(filePath)) {
    console.warn(`[patch-worklets-cmake] Skipped missing file: ${relativePath}`);
    return;
  }

  let contents = fs.readFileSync(filePath, "utf8");
  let patched = contents;

  for (const [from, to] of replacements) {
    patched = patched.replace(from, to);
  }

  if (patched !== contents) {
    fs.writeFileSync(filePath, patched);
    console.log(`[patch-worklets-cmake] Patched ${relativePath}`);
  }
}

function copyFileIfPresent(sourceRelativePath, destinationRelativePath) {
  const sourcePath = path.join(root, sourceRelativePath);
  const destinationPath = path.join(root, destinationRelativePath);

  if (!fs.existsSync(sourcePath)) {
    console.warn(`[patch-worklets-cmake] Skipped missing file: ${sourceRelativePath}`);
    return;
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  console.log(`[patch-worklets-cmake] Copied ${sourceRelativePath} to ${destinationRelativePath}`);
}

copyFileIfPresent(
  "assets/models/face_landmarker.task",
  "android/app/src/main/assets/face_landmarker.task"
);

patchFile("node_modules/react-native-mediapipe/android/src/main/java/com/reactnativemediapipe/facelandmarkdetection/FaceLandmarkDetectionFrameProcessorPlugin.kt", [
  [
    `  override fun callback(frame: Frame, params: MutableMap<String, Any>?): Any? {
    val detectorHandle: Double = params!!["detectorHandle"] as Double
    val detector = FaceLandmarkDetectorMap.detectorMap[detectorHandle.toInt()] ?: return false
`,
    `  override fun callback(frame: Frame, params: MutableMap<String, Any>?): Any? {
    val detectorHandle = params?.get("detectorHandle") as? Double ?: return false
    val detector = FaceLandmarkDetectorMap.detectorMap[detectorHandle.toInt()] ?: return false
`,
  ],
  [
    `    if (bitmap != null) {
      val rotated = rotateBitmap(bitmap, orientationToDegrees(frame.orientation).toFloat())
      val mpImage = BitmapImageBuilder(rotated).build()
      detector.detectLiveStream(mpImage, frame.orientation)
    }
`,
    `    if (bitmap != null) {
      val mpImage = BitmapImageBuilder(bitmap).build()
      detector.detectLiveStream(mpImage, frame.orientation)
    }
`,
  ],
]);

patchFile("node_modules/react-native-mediapipe/android/src/main/java/com/reactnativemediapipe/facelandmarkdetection/FaceLandmarkDetectorHelper.kt", [
  [
    `      faceLandmarkDetectorListener?.onResults(
        ResultBundle(listOf(result), inferenceTime, input.height, input.width)
      )
`,
    `      faceLandmarkDetectorListener?.onResults(
        ResultBundle(listOf(result), inferenceTime, input.height, input.width, this.imageRotation)
      )
`,
  ],
]);

patchFile("node_modules/react-native-worklets/android/CMakeLists.txt", [
  [
    `set(CPP_SHARED "\${CMAKE_ANDROID_NDK}/toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/lib/\${CMAKE_ANDROID_ARCH_ABI}/libc++_shared.so")
`,
    "",
  ],
  [
    "target_link_libraries(worklets log ReactAndroid::jsi fbjni::fbjni ${CPP_SHARED})",
    "target_link_libraries(worklets log c++_shared ReactAndroid::jsi fbjni::fbjni)",
  ],
  [
    "target_link_libraries(worklets log ReactAndroid::jsi fbjni::fbjni)",
    "target_link_libraries(worklets log c++_shared ReactAndroid::jsi fbjni::fbjni)",
  ],
  [
    `string(APPEND CMAKE_SHARED_LINKER_FLAGS " -lc++_shared")

`,
    "",
  ],
]);

patchFile("node_modules/react-native-worklets-core/android/CMakeLists.txt", [
  [
    `set(CPP_SHARED "\${CMAKE_ANDROID_NDK}/toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/lib/\${CMAKE_ANDROID_ARCH_ABI}/libc++_shared.so")
`,
    "",
  ],
  [
    `target_link_libraries(
  \${PACKAGE_NAME}
  log
  android
)`,
    `target_link_libraries(
  \${PACKAGE_NAME}
  log
  android
  c++_shared
)`,
  ],
  [
    `target_link_libraries(
  \${PACKAGE_NAME}
  \${CPP_SHARED}
)

`,
    "",
  ],
]);

patchFile("node_modules/react-native-vision-camera/android/CMakeLists.txt", [
  [
    `        \${PACKAGE_NAME}
        \${LOG_LIB}                          # <-- Logcat logger
        android                             # <-- Android JNI core
        ReactAndroid::jsi                   # <-- RN: JSI`,
    `        \${PACKAGE_NAME}
        \${LOG_LIB}                          # <-- Logcat logger
        android                             # <-- Android JNI core
        c++_shared                          # <-- Android C++ runtime
        ReactAndroid::jsi                   # <-- RN: JSI`,
  ],
  [
    `    message("VisionCamera: Linking react-native-worklets...")
    find_package(react-native-worklets-core REQUIRED CONFIG)
    target_link_libraries(
            \${PACKAGE_NAME}
            react-native-worklets-core::rnworklets
    )`,
    `    message("VisionCamera: Linking react-native-worklets...")
    target_include_directories(
            \${PACKAGE_NAME}
            PRIVATE
            "\${NODE_MODULES_DIR}/react-native-worklets-core/android/build/headers/rnworklets"
    )
    file(GLOB RNWORKLETS_LIB
            "\${NODE_MODULES_DIR}/react-native-worklets-core/android/build/intermediates/cxx/\${CMAKE_BUILD_TYPE}/*/obj/\${ANDROID_ABI}/librnworklets.so"
    )
    target_link_libraries(
            \${PACKAGE_NAME}
            \${RNWORKLETS_LIB}
    )`,
  ],
]);

patchFile("node_modules/react-native-reanimated/android/CMakeLists.txt", [
  [
    "target_link_libraries(reanimated log ReactAndroid::jsi fbjni::fbjni android\n                      worklets)",
    "target_link_libraries(reanimated log c++_shared ReactAndroid::jsi fbjni::fbjni android\n                      worklets)",
  ],
]);

patchFile("node_modules/react-native/ReactAndroid/cmake-utils/ReactNative-application.cmake", [
  [
    `target_link_libraries(\${CMAKE_PROJECT_NAME}
        fbjni                               # via 3rd party prefab`,
    `target_link_libraries(\${CMAKE_PROJECT_NAME}
        c++_shared                          # Android C++ runtime
        fbjni                               # via 3rd party prefab`,
  ],
  [
    `        foreach(autolinked_library \${AUTOLINKED_LIBRARIES})
            target_link_libraries(\${autolinked_library} common_flags)`,
    `        foreach(autolinked_library \${AUTOLINKED_LIBRARIES})
            target_link_libraries(\${autolinked_library} c++_shared)
            target_link_libraries(\${autolinked_library} common_flags)`,
  ],
]);

patchFile("node_modules/react-native-safe-area-context/android/src/main/jni/CMakeLists.txt", [
  [
    `  target_link_libraries(
          \${LIB_TARGET_NAME}
          fbjni
          jsi
          reactnative`,
    `  target_link_libraries(
          \${LIB_TARGET_NAME}
          c++_shared
          fbjni
          jsi
          reactnative`,
  ],
  [
    `  target_link_libraries(
          \${LIB_TARGET_NAME}
          fbjni
          folly_runtime`,
    `  target_link_libraries(
          \${LIB_TARGET_NAME}
          c++_shared
          fbjni
          folly_runtime`,
  ],
]);

patchFile("node_modules/react-native-screens/android/src/main/jni/CMakeLists.txt", [
  [
    `  target_link_libraries(
    \${LIB_TARGET_NAME}
    ReactAndroid::reactnative
    ReactAndroid::jsi`,
    `  target_link_libraries(
    \${LIB_TARGET_NAME}
    c++_shared
    ReactAndroid::reactnative
    ReactAndroid::jsi`,
  ],
  [
    `  target_link_libraries(
    \${LIB_TARGET_NAME}
    fbjni
    folly_runtime`,
    `  target_link_libraries(
    \${LIB_TARGET_NAME}
    c++_shared
    fbjni
    folly_runtime`,
  ],
]);

patchFile("node_modules/react-native-screens/android/CMakeLists.txt", [
  [
    `        target_link_libraries(rnscreens
            ReactAndroid::reactnative
            ReactAndroid::jsi
            fbjni::fbjni
            android
        )`,
    `        target_link_libraries(rnscreens
            c++_shared
            ReactAndroid::reactnative
            ReactAndroid::jsi
            fbjni::fbjni
            android
        )`,
  ],
  [
    `        target_link_libraries(
            rnscreens
                ReactAndroid::jsi`,
    `        target_link_libraries(
            rnscreens
                c++_shared
                ReactAndroid::jsi`,
  ],
  [
    `    target_link_libraries(rnscreens
        ReactAndroid::jsi
        android
    )`,
    `    target_link_libraries(rnscreens
        c++_shared
        ReactAndroid::jsi
        android
    )`,
  ],
]);

patchFile("node_modules/expo-modules-core/android/CMakeLists.txt", [
  [
    `target_link_libraries(
  \${PACKAGE_NAME}
  CommonSettings
  \${LOG_LIB}
  fbjni::fbjni`,
    `target_link_libraries(
  \${PACKAGE_NAME}
  CommonSettings
  \${LOG_LIB}
  fbjni::fbjni`,
  ],
  [
    `  android
  \${JSEXECUTOR_LIB}
  \${NEW_ARCHITECTURE_DEPENDENCIES}
)`,
    `  android
  \${JSEXECUTOR_LIB}
  \${NEW_ARCHITECTURE_DEPENDENCIES}
  c++_shared
)`,
  ],
  [
    `target_link_libraries(
  \${PACKAGE_NAME}
  ReactAndroid::reactnative
)`,
    `target_link_libraries(
  \${PACKAGE_NAME}
  ReactAndroid::reactnative
  c++_shared
)`,
  ],
]);

patchFile("node_modules/react-native-gesture-handler/android/src/main/jni/CMakeLists.txt", [
  [
    `target_link_libraries(
  \${PACKAGE_NAME}
  ReactAndroid::reactnative
  ReactAndroid::jsi
  fbjni::fbjni`,
    `target_link_libraries(
  \${PACKAGE_NAME}
  c++_shared
  ReactAndroid::reactnative
  ReactAndroid::jsi
  fbjni::fbjni`,
  ],
]);
