plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.myalarmclock.timer"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.myalarmclock.timer"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0.$versionCode"
    }

    // One fixed key so every new build installs over the previous one
    // and keeps the saved rounds and settings.
    signingConfigs {
        create("shared") {
            storeFile = file("../keystore/app.jks")
            storePassword = "myalarmclock"
            keyAlias = "app"
            keyPassword = "myalarmclock"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
        debug {
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
