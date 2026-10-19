import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

/* Release signing comes from gradle.properties (CI writes it from secrets); without it, release builds are unsigned. */
val signing = Properties().apply {
    listOf("CLOR_STORE_FILE", "CLOR_STORE_PASSWORD", "CLOR_KEY_ALIAS", "CLOR_KEY_PASSWORD").forEach { k ->
        project.findProperty(k)?.let { setProperty(k, it.toString()) }
    }
}

android {
    namespace = "in.clor.attendance"
    compileSdk = 35

    defaultConfig {
        /* Its own id, so it can be installed beside the web-based CLOR Attendance app while that is retired. */
        applicationId = "in.clor.attendance.employee"
        minSdk = 26
        targetSdk = 35
        versionCode = (project.findProperty("CLOR_VERSION_CODE") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("CLOR_VERSION_NAME") as String?) ?: "0.1.0"
        buildConfigField("String", "API_BASE", "\"${project.findProperty("CLOR_API_BASE") ?: "https://api.clor.in/api/portal"}\"")
    }

    signingConfigs {
        if (signing.getProperty("CLOR_STORE_FILE") != null) {
            create("release") {
                storeFile = file(signing.getProperty("CLOR_STORE_FILE"))
                storePassword = signing.getProperty("CLOR_STORE_PASSWORD")
                keyAlias = signing.getProperty("CLOR_KEY_ALIAS")
                keyPassword = signing.getProperty("CLOR_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")

    testImplementation("junit:junit:4.13.2")
}
