import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// Opero App：核心页面原生（Kotlin + Jetpack Compose），其它页面先嵌网页（WebView），见 docs/多端架构.md、docs/规范/App外壳.md
// 签名不在这里：流水线编没签名的 release 包，发布时再签名（证书不进仓库、不进流水线）
android {
    namespace = "cn.yimakeji.opero"
    compileSdk = 36

    defaultConfig {
        applicationId = "cn.yimakeji.opero"
        minSdk = 26
        targetSdk = 36
        versionCode = 8
        versionName = "0.5.0"
        // 登录页里默认填的地址（一人一套，用户改成自己的）
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
    buildFeatures {
        buildConfig = true
        compose = true
    }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

/**
 * 界面文字和网页用同一份字典（docs/多端架构.md「文案和翻译」）：编译时把 code/web/src/i18n/locales/<语言>.json 原样放进
 * assets/i18n/web-<语言>.json，App 自己才有的文字放 code/android/i18n/<语言>.json → assets/i18n/app-<语言>.json。
 * 代码里写中文原文 t("登录")，运行时按 Opero 设置的语言换（i18n/I18n.kt）。缺哪句跑 node scripts/i18n-check.mjs 看。
 */
abstract class OperoI18n : DefaultTask() {
    @get:InputDirectory @get:PathSensitive(PathSensitivity.RELATIVE) abstract val webLocales: DirectoryProperty
    @get:InputDirectory @get:PathSensitive(PathSensitivity.RELATIVE) abstract val appLocales: DirectoryProperty
    @get:OutputDirectory abstract val outputDir: DirectoryProperty

    @TaskAction fun copy() {
        val out = outputDir.get().asFile.resolve("i18n")
        out.deleteRecursively()
        out.mkdirs()
        webLocales.get().asFile.listFiles { f -> f.extension == "json" }.orEmpty().forEach { it.copyTo(out.resolve("web-${it.name}"), true) }
        appLocales.get().asFile.listFiles { f -> f.extension == "json" }.orEmpty().forEach { it.copyTo(out.resolve("app-${it.name}"), true) }
    }
}

val operoI18n = tasks.register<OperoI18n>("operoI18n") {
    webLocales.set(layout.projectDirectory.dir("../../web/src/i18n/locales"))
    appLocales.set(layout.projectDirectory.dir("../i18n"))
    outputDir.set(layout.buildDirectory.dir("generated/opero-i18n"))
}

androidComponents {
    onVariants { v -> v.sources.assets?.addGeneratedSourceDirectory(operoI18n, OperoI18n::outputDir) }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.androidx.work.runtime)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.biometric)
    // biometric 1.1.0 带进来的 fragment 1.2.5 会拦「请求码超过 16 位」，选文件 / 权限请求会闪退
    implementation(libs.androidx.fragment)
    // 原生界面（docs/多端架构.md：核心页面原生，其它页面先嵌网页）
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
}
