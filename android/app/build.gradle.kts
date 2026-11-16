import java.util.Properties

// ── Byte by Apurba Laskar ───────────────────────────────────────────────
// The id Android installs the app under (one place).
val byteApplicationId = "com.apurbalaskar.byte"

// Release signing key: android/key.properties (NOT in the source zip — see
// key.properties.example), or the file named by BYTE_KEY_PROPERTIES.
val keyProps = Properties().apply {
    val f = System.getenv("BYTE_KEY_PROPERTIES")?.let { file(it) } ?: rootProject.file("key.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val hasReleaseKey = keyProps.getProperty("storeFile") != null

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    // "byte" is a Java keyword, so the code package is byteapp; the installed
    // application id stays com.apurbalaskar.byte.
    namespace = "com.apurbalaskar.byteapp"
    // Use the SDK selected by Flutter so CI and local Android installations
    // do not depend on a platform package that may not be published yet.
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        applicationId = byteApplicationId
        minSdk = maxOf(flutter.minSdkVersion, 24)
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Release key (alias "apex", CN=Apurba Laskar). Every update must be signed
    // with the same key to install over the previous one — keep it safe.
    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keyProps.getProperty("storeFile"))
                storePassword = keyProps.getProperty("storePassword")
                keyAlias = keyProps.getProperty("keyAlias")
                keyPassword = keyProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Without key.properties a release build is signed with the local
            // debug key (fine for testing, cannot update the real app).
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
    implementation("androidx.webkit:webkit:1.15.0")
}
