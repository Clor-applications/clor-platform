package `in`.clor.attendance.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.ApiError
import `in`.clor.attendance.data.Files
import `in`.clor.attendance.data.Reminders
import `in`.clor.attendance.data.SignedOut
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Me: my documents (saved to Downloads and opened), my data as a file, the
 * privacy notice, the app's permissions, password and sign-out. Everything
 * else about my employment stays with HR on the web.
 */
@Composable
fun MeTab(api: Api, onSignedOut: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val me = rememberLoad(onSignedOut) { api.me() }
    val docs = rememberLoad(onSignedOut) { api.documents() }
    var notice by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    /* A save waiting for the storage permission (Android 8 and 9 only). */
    var pending by remember { mutableStateOf<(suspend () -> Unit)?>(null) }
    val storage = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        val job = pending
        pending = null
        if (ok && job != null) {
            scope.launch { job() }
        } else if (!ok) {
            message = "Storage not allowed, so the file could not be saved."
        }
    }
    fun save(job: suspend () -> Unit) {
        val needs = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        if (needs) {
            pending = job
            storage.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        } else {
            scope.launch { job() }
        }
    }
    suspend fun guarded(block: suspend () -> Unit) {
        try {
            block()
        } catch (e: SignedOut) {
            onSignedOut()
        } catch (e: ApiError) {
            message = e.message
        } catch (e: Exception) {
            message = "Could not save the file."
        }
    }

    if (notice) {
        NoticeScreen(api, onSignedOut, mustRead = false) { notice = false }
        return
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(screenPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        LoadView(me) { m ->
            Section {
                Text(m.employee.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Hint(listOfNotNull(m.employee.code, m.employee.designation, m.employee.department).joinToString(" · "))
                Hint(m.company.name)
            }
        }
        message?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        Section("My documents") {
            LoadView(docs) { d ->
                if (d.documents.isEmpty()) Hint("HR has not shared any documents with you.")
                d.documents.forEachIndexed { i, doc ->
                    if (i > 0) HorizontalDivider()
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(doc.title, style = MaterialTheme.typography.bodyLarge)
                            Hint("${doc.size / 1024} KB${doc.expiresOn?.let { " · valid until ${shortDate(it)}" } ?: ""}")
                        }
                        TextButton(onClick = {
                            save {
                                guarded {
                                    val file = api.document(doc.id).document
                                    val name = Files.safeName(file.title, file.mime)
                                    val uri = withContext(Dispatchers.IO) { Files.saveToDownloads(context, name, file.mime, Files.bytesOfDataUrl(file.dataUrl)) }
                                    message = "Saved to Downloads: $name"
                                    Files.open(context, uri, file.mime)
                                }
                            }
                        }) { Text("Open") }
                    }
                }
            }
        }
        Section("My data") {
            Text("Everything held about you, as a file you can keep.", style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = {
                save {
                    guarded {
                        val text = api.myData()
                        val name = "my-data-${java.time.LocalDate.now()}.json"
                        withContext(Dispatchers.IO) { Files.saveToDownloads(context, name, "application/json", text.toByteArray()) }
                        message = "Saved to Downloads: $name"
                    }
                }
            }) { Text("Download my data") }
            TextButton(onClick = { notice = true }) { Text("Privacy notice") }
            Hint("To correct or erase data, withdraw consent, name a nominee or complain, use My data in the web portal or ask HR.")
        }
        PermissionsCard(context)
        PasswordCard(api, onSignedOut)
        OutlinedButton(onClick = onSignedOut, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
    }
}

/** What the app may use, each with why; changing one opens Android's own settings. */
@Composable
private fun PermissionsCard(context: Context) {
    fun has(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED
    val rows = listOf(
        Triple("Location", has(Manifest.permission.ACCESS_FINE_LOCATION), "Read once when you punch from the phone."),
        Triple("Camera", has(Manifest.permission.CAMERA), "Only for a selfie you choose to add to a punch."),
        Triple("Notifications", Reminders.allowed(context), "Punch reminders and decisions on your requests."),
    )
    Section("Permissions") {
        rows.forEach { (name, on, why) ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(name, style = MaterialTheme.typography.bodyLarge)
                    Hint(why)
                }
                StatusPill(if (on) "Allowed" else "Off", if (on) Tone.Pos else Tone.Neutral)
            }
        }
        TextButton(onClick = {
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }) { Text("Change in Android settings") }
    }
}

@Composable
private fun PasswordCard(api: Api, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var busy by remember { mutableStateOf(false) }
    Section {
        if (!open) {
            Text("Change password", modifier = Modifier.fillMaxWidth().clickable { open = true }.padding(vertical = 4.dp), style = MaterialTheme.typography.bodyLarge)
        } else {
            Text("Change password", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            OutlinedTextField(current, { current = it }, label = { Text("Current password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(next, { next = it }, label = { Text("New password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
            note?.let { (t, ok) -> Text(t, color = if (ok) Pos else MaterialTheme.colorScheme.error) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    busy = true
                    scope.launch {
                        try {
                            api.changePassword(current, next)
                            note = "Changed. Your other phones are signed out." to true
                            current = ""
                            next = ""
                        } catch (e: SignedOut) {
                            onSignedOut()
                        } catch (e: ApiError) {
                            note = (e.message ?: "Not changed.") to false
                        } finally {
                            busy = false
                        }
                    }
                }, enabled = !busy && current.isNotEmpty() && next.length >= 8) { Text("Change") }
                TextButton(onClick = { open = false; note = null }) { Text("Close") }
            }
        }
    }
}
