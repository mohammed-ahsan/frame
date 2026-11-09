plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.frameflow.affiliates"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.frameflow.affiliates"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "2.0"
    }

    buildFeatures {
        buildConfig = true
    }

    flavorDimensions += "environment"
    productFlavors {
        create("dev") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            buildConfigField(
                "String",
                "API_BASE_URL",
                "\"${providers.gradleProperty("frameflowDevApiUrl").orElse("http://10.0.2.2:3000").get()}\"",
            )
            manifestPlaceholders["allowHttp"] = "true"
        }
        create("prod") {
            dimension = "environment"
            buildConfigField(
                "String",
                "API_BASE_URL",
                "\"${providers.gradleProperty("frameflowProdApiUrl").orElse("https://instagram.indexbase.online").get()}\"",
            )
            manifestPlaceholders["allowHttp"] = "false"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}
