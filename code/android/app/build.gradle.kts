import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// Opero App = 原生外壳 + WebView（网页就是你自己那套 Opero 的网页端）。设计见 docs/规范/App外壳.md
// 签名不在这里：流水线编没签名的 release 包，超级后台的服务器上签名（证书不进仓库、不进流水线）
android {
    namespace = "cn.yimakeji.opero"
    compileSdk = 36

    defaultConfig {
        applicationId = "cn.yimakeji.opero"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        // 第一次打开时「连接你的 Opero」里默认填的地址（一人一套，用户改成自己的）
        buildConfigField("String", "DEFAULT_SERVER", "\"\"") // 官网（opero.yimakeji.cn / yimaworks.com）只是介绍和试用，不预填；用户填自己服务器上的 Opero
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.androidx.work.runtime)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.biometric)
    // biometric 1.1.0 带进来的 fragment 1.2.5 会拦「请求码超过 16 位」，选文件 / 权限请求会闪退（KidLock 1.15.0 踩过）
    implementation(libs.androidx.fragment)
}
