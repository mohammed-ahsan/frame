package com.frameflow.affiliates

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private var cookieHeader = ""
    private var sourceFileId: String? = null
    private var generationId: String? = null
    private var editingSubmissionId: String? = null
    private var affiliate: JSONObject? = null
    private lateinit var screen: LinearLayout
    private lateinit var status: TextView
    private lateinit var styleName: EditText
    private lateinit var prompt: EditText
    private lateinit var bkashNumber: EditText
    private lateinit var generateButton: Button
    private lateinit var payoutButton: Button
    private lateinit var guide: LinearLayout
    private lateinit var guideStatus: TextView
    private lateinit var confirmPayoutButton: Button
    private lateinit var sourcePreview: ImageView
    private lateinit var generatedPreview: ImageView
    private lateinit var resultPanel: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CookieManager.getInstance().setAcceptCookie(true)
        cookieHeader = CookieManager.getInstance().getCookie(BuildConfig.API_BASE_URL).orEmpty()
        if (cookieHeader.contains("frameflow_session=")) {
            loadAffiliate()
        } else {
            showLogin()
        }
    }

    private fun showLogin() {
        webView?.destroy()
        webView = null
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(PAPER)
        }
        val heading = text("Frameflow Affiliates", 24f, INK, true).apply {
            setPadding(dp(24), dp(28), dp(24), dp(12))
        }
        val note = text(
            "Sign in with your Frameflow username. Affiliate access is checked against the dashboard list.",
            15f,
            MUTED,
        ).apply { setPadding(dp(24), 0, dp(24), dp(18)) }
        val view = WebView(this)
        webView = view
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.settings.allowFileAccess = false
        view.settings.allowContentAccess = true
        view.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return true
                if (!uri.host.equals(Uri.parse(BuildConfig.API_BASE_URL).host, true)) return true
                if (uri.path == "/app") {
                    finishLogin()
                    return true
                }
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (Uri.parse(url).path == "/app") finishLogin()
            }
        }
        container.addView(heading)
        container.addView(note)
        container.addView(view, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f,
        ))
        setContentView(container)
        view.loadUrl("${BuildConfig.API_BASE_URL}/login")
    }

    private fun finishLogin() {
        if (screenIsAttached()) return
        CookieManager.getInstance().flush()
        cookieHeader = CookieManager.getInstance().getCookie(BuildConfig.API_BASE_URL).orEmpty()
        if (!cookieHeader.contains("frameflow_session=")) {
            showLoginError("Sign-in finished but no Frameflow session was received. Please try again.")
            return
        }
        webView?.stopLoading()
        webView?.destroy()
        webView = null
        loadAffiliate()
    }

    private fun screenIsAttached(): Boolean = ::screen.isInitialized && screen.parent != null

    private fun showLoginError(message: String) {
        AlertDialog.Builder(this).setMessage(message).setPositiveButton("Continue") { _, _ -> showLogin() }.show()
    }

    private fun loadAffiliate() {
        showLoading("Loading your affiliate studio…")
        request("GET", "/api/affiliate", callback = { response ->
            if (response.error != null) {
                if (response.statusCode == 401) {
                    cookieHeader = ""
                    showLogin()
                } else {
                    showMessage(response.error)
                }
                return@request
            }
            affiliate = response.json
            showStudio()
        })
    }

    private fun showStudio() {
        screen = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(PAPER)
        }
        val scroll = ScrollView(this).apply { isFillViewport = true }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(14), dp(18), dp(34))
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(text("F  Frameflow", 19f, INK, true), LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(actionButton("Sign out") { signOut() })
        content.addView(header)

        val user = affiliate?.optString("username").orEmpty()
        content.addView(text("Earn with Frameflow", 13f, MUTED, true), topMargin(22))
        content.addView(text("Make a style.\nSubmit your best.", 33f, INK, true), topMargin(8))
        content.addView(text("Create an image with your style name and prompt, then submit it for review.", 14f, MUTED), topMargin(8))

        val summary = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            setBackgroundColor(INK)
        }
        summary.addView(text("AFFILIATE  ·  $user", 13f, PAPER, true))
        summary.addView(text(
            "Approved balance  ${money(affiliate?.optLong("balancePaisa") ?: 0L)}",
            20f,
            LIME,
            true,
        ), topMargin(10))
        summary.addView(text(
            "${money(affiliate?.optLong("availablePaisa") ?: 0L)} available",
            12f,
            PAPER,
        ), topMargin(4))
        summary.addView(text(
            "Web ${affiliate?.optInt("webGenerationsUsed") ?: 0} / ${affiliate?.optInt("webGenerationLimit") ?: 30}  ·  " +
                "Android ${affiliate?.optInt("appGenerationsUsed") ?: 0} / ${affiliate?.optInt("appGenerationLimit") ?: 50} today",
            12f,
            PAPER,
        ), topMargin(8))
        summary.addView(text("Daily limits reset at 00:00 UTC", 11f, PAPER), topMargin(3))
        content.addView(summary, topMargin(18))

        content.addView(sectionTitle("01  Add your photo"), topMargin(22))
        val sourceRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        sourcePreview = imageView(108, 132)
        sourceRow.addView(sourcePreview)
        sourceRow.addView(actionButton("Choose photo") { choosePhoto() }, leftMargin(12))
        content.addView(sourceRow, topMargin(10))

        content.addView(sectionTitle("02  Describe your style"), topMargin(18))
        styleName = editField("Style name", 80)
        content.addView(styleName, topMargin(9))
        prompt = editField("Describe lighting, colors, setting, mood and composition", 2000, multiline = true)
        content.addView(prompt, topMargin(9))
        content.addView(text("Changing the name or prompt clears the current result. Generate again to keep the image and prompt matched.", 12f, MUTED), topMargin(8))
        generateButton = primaryButton("Generate image") { generateImage() }.apply { isEnabled = false }
        content.addView(generateButton, topMargin(12))
        status = text("", 12f, MUTED)
        content.addView(status, topMargin(8))
        styleName.addTextChangedListener(SimpleTextWatcher { invalidateGenerationIfEdited() })
        prompt.addTextChangedListener(SimpleTextWatcher { invalidateGenerationIfEdited() })

        resultPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
            setBackgroundColor(WHITE)
            visibility = View.GONE
        }
        resultPanel.addView(sectionTitle("Your result"))
        generatedPreview = imageView(260, 320)
        resultPanel.addView(generatedPreview, topMargin(12))
        resultPanel.addView(primaryButton("Submit for review · ৳50") { submitGeneration() }, topMargin(12))
        content.addView(resultPanel, topMargin(20))

        content.addView(sectionTitle("A quick guide"), topMargin(28))
        content.addView(text(
            "Be specific about lighting, palette, location and framing. Refine one or two details at a time. " +
                "Approved submissions earn ৳50 each; review feedback is expected within about 2 hours.",
            13f,
            MUTED,
        ), topMargin(8))

        content.addView(sectionTitle("Submission history"), topMargin(26))
        val history = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; tag = TAG_HISTORY }
        content.addView(history, topMargin(8))
        renderSubmissions(affiliate?.optJSONArray("submissions") ?: JSONArray())

        content.addView(sectionTitle("Withdraw earnings"), topMargin(26))
        content.addView(text("Enter your bKash number to see the withdrawal steps.", 12f, MUTED), topMargin(5))
        val payoutRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.BOTTOM
        }
        bkashNumber = editField("017*******", 11).apply {
            inputType = android.text.InputType.TYPE_CLASS_PHONE
            filters = arrayOf(android.text.InputFilter.LengthFilter(11))
        }
        payoutRow.addView(bkashNumber, LinearLayout.LayoutParams(0, dp(52), 1f))
        payoutButton = primaryButton("Withdrawal guide") { showWithdrawalGuide() }.apply { isEnabled = false }
        payoutRow.addView(payoutButton, leftMargin(8))
        content.addView(payoutRow, topMargin(10))
        bkashNumber.addTextChangedListener(SimpleTextWatcher { updatePayoutButton() })
        guide = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
            setBackgroundColor(Color.rgb(236, 230, 216))
            visibility = View.GONE
        }
        guide.addView(sectionTitle("How to request a withdrawal"))
        guide.addView(text(
            "1. Each approved style adds ৳50 to your earnings.\n\n" +
                "2. Withdrawals can be requested once your available balance reaches ৳1,500.\n\n" +
                "3. Confirm the bKash number is correct. Requested withdrawals are disbursed within 2 hours.",
            13f,
            MUTED,
        ), topMargin(10))
        guideStatus = text("", 12f, MUTED)
        guide.addView(guideStatus, topMargin(10))
        confirmPayoutButton = primaryButton("Confirm withdrawal") { requestPayout() }
        guide.addView(confirmPayoutButton, topMargin(10))
        content.addView(guide, topMargin(10))
        content.addView(text("Withdrawal history", 14f, INK, true), topMargin(18))
        val withdrawals = affiliate?.optJSONArray("withdrawals") ?: JSONArray()
        for (index in 0 until withdrawals.length()) {
            val item = withdrawals.optJSONObject(index) ?: continue
            content.addView(text(
                "${money(item.optLong("amountPaisa"))}  ·  ${item.optString("status")}",
                12f,
                MUTED,
            ), topMargin(6))
        }

        scroll.addView(content)
        screen.addView(scroll)
        setContentView(screen)
        updateGenerateButton()
    }

    private fun renderSubmissions(submissions: JSONArray) {
        if (!::screen.isInitialized || !screenIsAttached()) return
        val history = screen.findViewWithTag<LinearLayout>(TAG_HISTORY) ?: return
        history.removeAllViews()
        if (submissions.length() == 0) {
            history.addView(text("Your submissions will appear here.", 12f, MUTED))
            return
        }
        for (index in 0 until submissions.length()) {
            val item = submissions.optJSONObject(index) ?: continue
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(dp(10), dp(10), dp(10), dp(10))
                setBackgroundColor(WHITE)
            }
            val thumb = imageView(74, 94)
            card.addView(thumb)
            loadImage(item.optString("imageUrl")) { bitmap -> thumb.setImageBitmap(bitmap) }
            val details = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            details.addView(text(item.optString("styleName"), 15f, INK, true))
            val itemStatus = item.optString("status")
            val label = when (itemStatus) {
                "feedback" -> "Feedback requested"
                "approved" -> "Approved · ৳50"
                "rejected" -> "Not approved"
                else -> "Under review"
            }
            details.addView(text("✓ Generated  →  ✓ Submitted  →  $label", 11f, MUTED), topMargin(7))
            details.addView(text(item.optString("prompt"), 11f, MUTED), topMargin(5))
            if (item.optString("feedback").isNotBlank()) {
                details.addView(text("Feedback: ${item.optString("feedback")}", 11f, INK), topMargin(5))
            }
            if (itemStatus == "pending") details.addView(text("Feedback expected within about 2 hours.", 10f, MUTED), topMargin(5))
            if (itemStatus == "feedback") {
                details.addView(actionButton("Edit and resubmit") { startRevision(item) }, topMargin(8))
            }
            card.addView(details, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(10) })
            history.addView(card)
            if (index < submissions.length() - 1) history.addView(spacer(8))
        }
    }

    private fun startRevision(item: JSONObject) {
        editingSubmissionId = item.optString("id")
        sourceFileId = item.optString("sourceFileId")
        generationId = null
        styleName.setText(item.optString("styleName"))
        prompt.setText(item.optString("prompt"))
        resultPanel.visibility = View.GONE
        status.text = "Revise the prompt based on dashboard feedback, then generate a fresh image."
        loadImage(item.optString("sourceImageUrl")) { bitmap -> sourcePreview.setImageBitmap(bitmap) }
        updateGenerateButton()
        scrollToView(styleName)
    }

    private fun invalidateGenerationIfEdited() {
        if (generationId != null) {
            generationId = null
            resultPanel.visibility = View.GONE
            status.text = "Prompt changed. Generate a fresh matching image before submitting."
        }
        updateGenerateButton()
    }

    private fun updateGenerateButton() {
        if (!::generateButton.isInitialized) return
        generateButton.isEnabled = !sourceFileId.isNullOrBlank()
            && styleName.text.toString().trim().length >= 2
            && prompt.text.toString().trim().length >= 20
    }

    private fun choosePhoto() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
        }
        startActivityForResult(intent, PICK_IMAGE_REQUEST)
    }

    @Deprecated("Photo selection is handled through the system document picker.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != PICK_IMAGE_REQUEST || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        worker.execute {
            val result = runCatching { uploadImage(uri) }
            mainHandler.post {
                result.onSuccess { media ->
                    sourceFileId = media.optString("id")
                    generationId = null
                    resultPanel.visibility = View.GONE
                    status.text = "Photo ready. Describe your style."
                    loadImage(media.optString("contentUrl")) { bitmap -> sourcePreview.setImageBitmap(bitmap) }
                    updateGenerateButton()
                }.onFailure { showMessage(it.message ?: "Photo upload failed.") }
            }
        }
    }

    private fun uploadImage(uri: Uri): JSONObject {
        val bytes = contentResolver.openInputStream(uri)?.use { input ->
            val output = ByteArrayOutputStream()
            input.copyTo(output)
            output.toByteArray()
        } ?: error("Could not read the selected photo.")
        require(bytes.size <= 12 * 1024 * 1024) { "Choose an image smaller than 12 MB." }
        val boundary = "Frameflow-${System.currentTimeMillis()}"
        val fileName = "affiliate-photo.jpg"
        val mime = contentResolver.getType(uri) ?: "image/jpeg"
        val body = ByteArrayOutputStream().apply {
            write("--$boundary\r\n".toByteArray())
            write("Content-Disposition: form-data; name=\"image\"; filename=\"$fileName\"\r\n".toByteArray())
            write("Content-Type: $mime\r\n\r\n".toByteArray())
            write(bytes)
            write("\r\n--$boundary--\r\n".toByteArray())
        }.toByteArray()
        return apiSync("POST", "/api/media", body, "multipart/form-data; boundary=$boundary").getJSONObject("media")
    }

    private fun generateImage() {
        val sourceId = sourceFileId ?: return
        generateButton.isEnabled = false
        status.text = "Generating your image…"
        val body = JSONObject()
            .put("sourceFileId", sourceId)
            .put("styleName", styleName.text.toString().trim())
            .put("prompt", prompt.text.toString().trim())
        request(
            "POST",
            "/api/affiliate/generations",
            body,
            mapOf("X-Frameflow-Client" to "android-affiliates"),
        ) { response ->
            if (response.error != null) {
                status.text = response.error
                updateGenerateButton()
                return@request
            }
            val result = response.json ?: JSONObject()
            val generation = result.optJSONObject("generation") ?: JSONObject()
            generationId = generation.optString("id")
            resultPanel.visibility = View.VISIBLE
            status.text = "${result.optInt("generationLimit") - result.optInt("generationsUsed")} generations left today."
            loadImage(generation.optJSONObject("image")?.optString("contentUrl").orEmpty()) { bitmap ->
                generatedPreview.setImageBitmap(bitmap)
            }
            updateGenerateButton()
        }
    }

    private fun submitGeneration() {
        val currentGenerationId = generationId ?: return
        AlertDialog.Builder(this)
            .setTitle("Submit this style?")
            .setMessage("Submit this image with its matching style name and prompt for review?")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Submit") { _, _ ->
                status.text = "Submitting for review…"
                val editingId = editingSubmissionId
                request(
                    if (editingId == null) "POST" else "PUT",
                    if (editingId == null) "/api/affiliate/submissions" else "/api/affiliate/submissions/${enc(editingId)}",
                    JSONObject().put("generationId", currentGenerationId),
                ) { response ->
                    status.text = response.error ?: "Submitted for review."
                    if (response.error == null) {
                        generationId = null
                        editingSubmissionId = null
                        resultPanel.visibility = View.GONE
                        refreshAffiliate()
                    }
                }
            }
            .show()
    }

    private fun updatePayoutButton() {
        if (!::payoutButton.isInitialized) return
        val numberValid = Regex("^01[3-9]\\d{8}$").matches(bkashNumber.text.toString())
        val hasActiveRequest = affiliate?.optJSONObject("activeWithdrawal") != null
        payoutButton.isEnabled = numberValid && !hasActiveRequest
    }

    private fun showWithdrawalGuide() {
        val data = affiliate ?: return
        guide.visibility = View.VISIBLE
        val minimum = data.optLong("minimumPayoutPaisa", 150000)
        val available = data.optLong("availablePaisa")
        val active = data.optJSONObject("activeWithdrawal") != null
        val eligible = available >= minimum && !active
        confirmPayoutButton.visibility = if (eligible) View.VISIBLE else View.GONE
        guideStatus.text = when {
            active -> "A withdrawal is already requested. It will be disbursed within 2 hours."
            eligible -> "Your balance is eligible. Confirm below to request the withdrawal."
            else -> "Keep submitting styles for approval. You can confirm a withdrawal request once your available earnings reach ${money(minimum)}."
        }
        scrollToView(guide)
    }

    private fun requestPayout() {
        confirmPayoutButton.isEnabled = false
        guideStatus.text = "Submitting your withdrawal request…"
        request(
            "POST",
            "/api/payout-requests",
            JSONObject().put("bkashNumber", bkashNumber.text.toString()),
        ) { response ->
            guideStatus.text = response.error ?: "Withdrawal requested. It will be disbursed within 2 hours."
            if (response.error == null) refreshAffiliate() else confirmPayoutButton.isEnabled = true
        }
    }

    private fun signOut() {
        request("POST", "/api/auth/logout") {
            cookieHeader = ""
            CookieManager.getInstance().removeAllCookies(null)
            showLogin()
        }
    }

    private fun refreshAffiliate() {
        request("GET", "/api/affiliate") { response ->
            if (response.error != null) {
                showMessage(response.error)
                return@request
            }
            affiliate = response.json
            showStudio()
        }
    }

    private fun loadImage(path: String, onLoaded: (Bitmap) -> Unit) {
        if (path.isBlank()) return
        worker.execute {
            runCatching {
                val connection = connection(path)
                connection.requestMethod = "GET"
                connection.setRequestProperty("Cookie", cookieHeader)
                connection.connectTimeout = 15000
                connection.readTimeout = 60000
                val bytes = connection.inputStream.use { it.readBytes() }
                connection.disconnect()
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: error("Image could not be decoded.")
            }.onSuccess { bitmap -> mainHandler.post { onLoaded(bitmap) } }
                .onFailure { error ->
                    mainHandler.post { if (::status.isInitialized) status.text = error.message ?: "Image could not be loaded." }
                }
        }
    }

    private fun request(
        method: String,
        path: String,
        body: JSONObject? = null,
        headers: Map<String, String> = emptyMap(),
        callback: (ApiResponse) -> Unit,
    ) {
        worker.execute {
            val response = runCatching { apiSync(method, path, body?.toString()?.toByteArray(), "application/json", headers) }
                .fold(
                    onSuccess = { ApiResponse(it, null, 200) },
                    onFailure = {
                        val status = (it as? ApiFailure)?.statusCode ?: 0
                        ApiResponse(null, it.message ?: "Request failed.", status)
                    },
                )
            mainHandler.post { callback(response) }
        }
    }

    private fun apiSync(
        method: String,
        path: String,
        body: ByteArray? = null,
        contentType: String = "application/json",
        headers: Map<String, String> = emptyMap(),
    ): JSONObject {
        val connection = connection(path)
        connection.requestMethod = method
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Cookie", cookieHeader)
        headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", contentType)
            connection.outputStream.use { it.write(body) }
        }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val responseText = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        connection.disconnect()
        if (code !in 200..299) {
            val message = runCatching { JSONObject(responseText).optString("error") }.getOrNull()
                .takeUnless { it.isNullOrBlank() } ?: "Request failed ($code)."
            throw ApiFailure(code, message)
        }
        if (responseText.isBlank()) return JSONObject()
        return JSONObject(responseText)
    }

    private fun connection(path: String): HttpURLConnection {
        val base = BuildConfig.API_BASE_URL.trimEnd('/')
        val target = if (path.startsWith("http://") || path.startsWith("https://")) path else "$base/${path.trimStart('/')}"
        return (URL(target).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 180000
            setRequestProperty("X-Frameflow-Client", "android-affiliates")
        }
    }

    private fun showLoading(message: String) {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(PAPER)
            setPadding(dp(24), dp(24), dp(24), dp(24))
        }
        container.addView(ProgressBar(this))
        container.addView(text(message, 14f, MUTED), topMargin(14))
        setContentView(container)
    }

    private fun showMessage(message: String) {
        if (!::screen.isInitialized || !screenIsAttached()) {
            setContentView(text(message, 15f, INK).apply { setPadding(dp(24), dp(24), dp(24), dp(24)) })
        } else {
            AlertDialog.Builder(this).setMessage(message).setPositiveButton("OK", null).show()
        }
    }

    private fun imageView(widthDp: Int, heightDp: Int) = ImageView(this).apply {
        layoutParams = LinearLayout.LayoutParams(dp(widthDp), dp(heightDp))
        scaleType = ImageView.ScaleType.CENTER_CROP
        setBackgroundColor(Color.rgb(230, 224, 212))
        contentDescription = "Affiliate image preview"
    }

    private fun editField(hintText: String, maxLength: Int, multiline: Boolean = false) =
        EditText(this).apply {
            hint = hintText
            textSize = 14f
            setTextColor(INK)
            setHintTextColor(MUTED)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            filters = arrayOf(android.text.InputFilter.LengthFilter(maxLength))
            if (multiline) {
                minLines = 4
                gravity = Gravity.TOP
                inputType = android.text.InputType.TYPE_CLASS_TEXT or
                    android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                    android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            } else {
                setSingleLine(true)
                inputType = android.text.InputType.TYPE_CLASS_TEXT
            }
            setBackgroundColor(WHITE)
        }

    private fun primaryButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13f
        setTextColor(INK)
        setBackgroundColor(LIME)
        setPadding(dp(12), dp(4), dp(12), dp(4))
        setOnClickListener { action() }
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 12f
        setTextColor(INK)
        setOnClickListener { action() }
    }

    private fun sectionTitle(label: String) = text(label, 15f, INK, true)

    private fun text(label: String, size: Float, color: Int, bold: Boolean = false) =
        TextView(this).apply {
            text = label
            textSize = size
            setTextColor(color)
            if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
            setLineSpacing(dp(2).toFloat(), 1f)
        }

    private fun spacer(height: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(height)) }

    private fun topMargin(value: Int) = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(value) }

    private fun leftMargin(value: Int) = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { leftMargin = dp(value) }

    private fun scrollToView(view: View) {
        view.post { view.requestRectangleOnScreen(android.graphics.Rect(0, 0, view.width, view.height), true) }
    }

    private fun money(paisa: Long): String = "৳${"%,.0f".format(paisa / 100.0)}"

    private fun enc(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        worker.shutdownNow()
        webView?.destroy()
        super.onDestroy()
    }

    private data class ApiResponse(val json: JSONObject?, val error: String?, val statusCode: Int)
    private class ApiFailure(val statusCode: Int, message: String) : Exception(message)
    private class SimpleTextWatcher(private val action: () -> Unit) : android.text.TextWatcher {
        override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit
        override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) = action()
        override fun afterTextChanged(text: android.text.Editable?) = Unit
    }

    companion object {
        private const val PICK_IMAGE_REQUEST = 7021
        private const val TAG_HISTORY = "affiliate-history"
        private val INK = Color.rgb(22, 20, 15)
        private val PAPER = Color.rgb(245, 240, 230)
        private val WHITE = Color.rgb(255, 253, 248)
        private val LIME = Color.rgb(216, 255, 82)
        private val MUTED = Color.rgb(108, 103, 94)
    }
}
