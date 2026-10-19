package `in`.clor.attendance.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.ApiError
import `in`.clor.attendance.data.Reminders
import `in`.clor.attendance.data.Session
import kotlinx.coroutines.launch

/**
 * The whole app: sign in, read the company's privacy notice if it is new, then
 * four tabs — Today, Attendance, Leave, Me — and Approvals for people who
 * approve. Everything else stays on the web.
 */
@Composable
fun ClorApp(api: Api, session: Session) {
    val context = LocalContext.current
    var signedIn by remember { mutableStateOf(session.signedIn()) }
    /* Bumped to make the tabs read again after something changes (a punch, a request). */
    var version by remember { mutableIntStateOf(0) }
    val signOut = {
        session.clear()
        Reminders.stop(context)
        signedIn = false
    }
    if (!signedIn) {
        SignInScreen(api, session) {
            signedIn = true
            Reminders.start(context)
        }
        return
    }
    /* Only who they are and whether they approve; each tab loads its own data. */
    val me = rememberLoad(onSignedOut = signOut) { api.me() }
    when (val s = me.state) {
        is Load.Ready -> {
            val privacy = s.value.privacy
            if (privacy != null && !privacy.read) {
                NoticeScreen(api, onSignedOut = signOut, mustRead = true) { me.reload() }
            } else {
                Tabs(api, s.value.approver, version, onChanged = { version++ }, onSignedOut = signOut)
            }
        }
        else -> Fill { Column(Modifier.padding(top = 96.dp)) { LoadView(me) {} } }
    }
}

private enum class Tab(val label: String) { Home("Home"), Attendance("Attendance"), Leave("Leave"), Approvals("Approvals"), Me("Me") }

@Composable
private fun Tabs(api: Api, approver: Boolean, version: Int, onChanged: () -> Unit, onSignedOut: () -> Unit) {
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    /* "Apply for leave" from Home opens the Leave tab with the form already open. */
    var applyLeave by remember { mutableStateOf(false) }
    val links = HomeLinks(
        attendance = { tab = Tab.Attendance },
        applyLeave = { applyLeave = true; tab = Tab.Leave },
        leave = { tab = Tab.Leave },
        approvals = { tab = if (approver) Tab.Approvals else Tab.Home },
        me = { tab = Tab.Me },
    )
    val tabs = Tab.entries.filter { it != Tab.Approvals || approver }
    Scaffold(
        bottomBar = {
            NavigationBar {
                tabs.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t,
                        onClick = { tab = t },
                        icon = {
                            Icon(
                                when (t) {
                                    Tab.Home -> Icons.Outlined.Home
                                    Tab.Attendance -> Icons.Outlined.CalendarMonth
                                    Tab.Leave -> Icons.Outlined.EventAvailable
                                    Tab.Approvals -> Icons.Outlined.Inbox
                                    Tab.Me -> Icons.Outlined.Person
                                },
                                contentDescription = null,
                            )
                        },
                        label = { Text(t.label) },
                    )
                }
            }
        },
    ) { inner ->
        Column(Modifier.padding(inner).fillMaxSize()) {
            when (tab) {
                Tab.Home -> HomeTab(api, version, links, onChanged, onSignedOut)
                Tab.Attendance -> AttendanceTab(api, version, onChanged, onSignedOut)
                Tab.Leave -> LeaveTab(api, version, onChanged, onSignedOut, startApplying = applyLeave, onApplyShown = { applyLeave = false })
                Tab.Approvals -> ApprovalsTab(api, onSignedOut)
                Tab.Me -> MeTab(api, onSignedOut)
            }
        }
    }
}

/** Company code + employee code + password; or, the first time, the activation code HR gave. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SignInScreen(api: Api, session: Session, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var firstTime by rememberSaveable { mutableStateOf(false) }
    var company by rememberSaveable { mutableStateOf(session.lastCompany) }
    var code by rememberSaveable { mutableStateOf(session.lastEmployeeCode) }
    var activation by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Scaffold { inner ->
        Column(
            Modifier.padding(inner).fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            androidx.compose.foundation.layout.Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, modifier = Modifier.padding(top = 32.dp)) {
                androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(`in`.clor.attendance.R.drawable.clor_app_icon), contentDescription = null, modifier = androidx.compose.ui.Modifier.padding(end = 12.dp).size(56.dp))
                Text("CLOR Attendance", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            }
            Text(if (firstTime) "Set up your sign-in with the code HR gave you." else "Sign in with your company code and employee code.", style = MaterialTheme.typography.bodyMedium)
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(selected = !firstTime, onClick = { firstTime = false; error = null }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("Sign in") }
                SegmentedButton(selected = firstTime, onClick = { firstTime = true; error = null }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("First time") }
            }
            OutlinedTextField(company, { company = it.uppercase() }, label = { Text("Company code") }, placeholder = { Text("e.g. SUND-C101") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Next))
            OutlinedTextField(code, { code = it }, label = { Text("Employee code") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next))
            if (firstTime) {
                OutlinedTextField(activation, { activation = it.uppercase() }, label = { Text("Activation code") }, placeholder = { Text("ABCD-EF23") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Next))
            }
            OutlinedTextField(password, { password = it }, label = { Text(if (firstTime) "Choose a password" else "Password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done), modifier = Modifier.fillMaxWidth())
            if (firstTime) Hint("At least 8 characters, with a letter and a number.")
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            Button(
                onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            if (firstTime) api.activate(company.trim(), code.trim(), activation.trim(), password) else api.signIn(company.trim(), code.trim(), password)
                            session.lastCompany = company.trim()
                            session.lastEmployeeCode = code.trim()
                            onDone()
                        } catch (e: ApiError) {
                            error = e.message
                        } catch (e: Exception) {
                            error = "Something went wrong. Try again."
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy && company.isNotBlank() && code.isNotBlank() && password.isNotEmpty() && (!firstTime || activation.isNotBlank()),
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            ) { Text(if (busy) "Please wait…" else if (firstTime) "Set password and sign in" else "Sign in") }
            Hint("No code? Ask HR to switch on the employee portal for you.")
        }
    }
}

/**
 * The company's privacy notice (DPDP). When it is new it must be read before
 * the app opens; from Me it can be read any time.
 */
@Composable
fun NoticeScreen(api: Api, onSignedOut: () -> Unit, mustRead: Boolean, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    val notice = rememberLoad(onSignedOut) { api.notice() }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Scaffold { inner ->
        Column(Modifier.padding(inner).fillMaxSize().verticalScroll(rememberScrollState()).padding(screenPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            LoadView(notice) { n ->
                Text("How ${n.notice.company.ifEmpty { "your employer" }} uses your attendance data", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                n.notice.sections.forEach { sec ->
                    Section(sec.title) { sec.items.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) } }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (mustRead && !n.read) {
                    Button(
                        onClick = {
                            busy = true
                            scope.launch {
                                try {
                                    api.readNotice(n.notice.version)
                                    onDone()
                                } catch (e: ApiError) {
                                    error = e.message
                                    notice.reload()
                                } finally {
                                    busy = false
                                }
                            }
                        },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("I have read this") }
                } else {
                    TextButton(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Close") }
                }
            }
        }
    }
}
