package jp.heartrelay.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

private val Red = Color(0xFFC62828)
private val Orange = Color(0xFFEF6C00)
private val Green = Color(0xFF2E7D32)

fun urgencyColor(u: String) = when (u) {
    "high" -> Red
    "medium" -> Orange
    else -> Green
}

fun urgencyLabel(u: String) = when (u) {
    "high" -> "緊急度: 高"
    "medium" -> "緊急度: 中"
    else -> "緊急度: 低"
}

@Composable
fun HeartRelayApp(vm: AppViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    MaterialTheme(colorScheme = lightColorScheme(primary = Red)) {
        Surface(Modifier.fillMaxSize()) {
            when (val sc = s.screen) {
                Screen.Settings -> {
                    BackHandler(enabled = s.staffId != null) { vm.back() }
                    SettingsScreen(s, vm)
                }
                Screen.Inbox -> InboxScreen(s, vm)
                is Screen.Detail -> {
                    BackHandler { vm.back() }
                    DetailScreen(s, sc.id, vm)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(s: UiState, vm: AppViewModel) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("設定・職員選択") },
                navigationIcon = {
                    if (s.staffId != null) IconButton(onClick = { vm.back() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る")
                    }
                },
            )
        }
    ) { pad ->
        LazyColumn(
            Modifier.padding(pad).fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                OutlinedTextField(
                    value = s.serverUrl,
                    onValueChange = vm::onServerUrlChange,
                    label = { Text("サーバURL") },
                    placeholder = { Text("http://10.0.2.2:8787") },
                    supportingText = { Text("PCのIPアドレス 例: http://192.168.1.10:8787") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Button(onClick = vm::checkConnection, enabled = s.check != Check.Loading, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text("接続確認")
                }
                Spacer(Modifier.height(8.dp))
                when (val c = s.check) {
                    Check.Loading -> Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp)); Text("接続中…")
                    }
                    is Check.Ok -> Text(
                        "接続OK (ok=${c.health.ok}) 解析モード: ${c.health.analyzer ?: "不明"}" +
                            (c.health.model?.let { " / $it" } ?: ""),
                        color = Green, fontWeight = FontWeight.Bold,
                    )
                    is Check.Error -> Text("接続できません: ${c.message}", color = Red)
                    Check.Idle -> {}
                }
                if (s.staffLoading) Text("職員一覧を取得中…")
                s.staffError?.let { Text("職員一覧エラー: $it", color = Red) }
                if (s.staff.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Text("あなたの職員アカウントを選んでください", style = MaterialTheme.typography.titleMedium)
                }
            }
            val grouped = s.staff.groupBy { it.role }
            val roles = ROLE_ORDER.filter { it in grouped } + grouped.keys.filter { it !in ROLE_ORDER }
            roles.forEach { role ->
                item(key = "h_$role") {
                    Text(role, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(top = 8.dp))
                }
                items(grouped[role].orEmpty(), key = { it.id }) { st ->
                    val selected = st.id == s.staffId
                    OutlinedCard(
                        onClick = { vm.selectStaff(st) },
                        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) Red else MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(12.dp).heightIn(min = 32.dp)) {
                            Text(st.name, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                            if (st.duties.isNotEmpty()) Text(st.duties.joinToString("、"), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(s: UiState, vm: AppViewModel) {
    // フォアグラウンド(STARTED)の間だけ5秒ごとにポーリング
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(s.staffId, owner) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                vm.refresh(manual = false)
                delay(5000)
            }
        }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(s.staffName, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(s.staffRole, style = MaterialTheme.typography.bodySmall)
                    }
                },
                actions = {
                    IconButton(onClick = { vm.refresh(manual = true) }) { Icon(Icons.Default.Refresh, "更新") }
                    TextButton(onClick = vm::switchStaff) { Text("職員を切り替える") }
                },
            )
        }
    ) { pad ->
        PullToRefreshBox(
            isRefreshing = s.refreshing,
            onRefresh = { vm.refresh(manual = true) },
            modifier = Modifier.padding(pad).fillMaxSize(),
        ) {
            Column(Modifier.fillMaxSize()) {
                s.inboxError?.let {
                    Text("更新できません: $it", color = Color.White,
                        modifier = Modifier.fillMaxWidth().background(Red).padding(8.dp), fontSize = 13.sp)
                }
                if (s.deliveries.isEmpty()) {
                    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(32.dp), contentAlignment = Alignment.Center) {
                        Text(if (s.loaded) "あなた宛ての連絡はまだありません" else "読み込み中…", style = MaterialTheme.typography.bodyLarge)
                    }
                } else {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(12.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(s.deliveries, key = { it.id }) { d -> DeliveryCard(d) { vm.openDetail(d.id) } }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DeliveryCard(d: Delivery, onClick: () -> Unit) {
    val unack = !d.isAcknowledged
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = if (unack) Color(0xFFFFF3E0) else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)),
        elevation = CardDefaults.cardElevation(if (unack) 3.dp else 0.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(8.dp).fillMaxHeight().background(urgencyColor(d.urgency)))
            Column(Modifier.padding(12.dp).weight(1f)) {
                Text(d.title, fontSize = 17.sp, fontWeight = if (unack) FontWeight.Bold else FontWeight.Normal, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (d.categories.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
                        d.categories.forEach { AssistChip(onClick = onClick, label = { Text(it, fontSize = 12.sp) }, modifier = Modifier.height(28.dp)) }
                    }
                }
                Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(TimeFmt.hhmm(d.createdAt), style = MaterialTheme.typography.bodyMedium)
                    if (unack) Text("未確認", color = Color.White, fontWeight = FontWeight.Bold,
                        modifier = Modifier.background(Red, RoundedCornerShape(6.dp)).padding(horizontal = 10.dp, vertical = 2.dp))
                    else Text("確認済み ${TimeFmt.hhmm(d.acknowledgedAt)}", color = Green)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DetailScreen(s: UiState, id: String, vm: AppViewModel) {
    val d = s.deliveries.firstOrNull { it.id == id }
    val snack = remember { SnackbarHostState() }
    val ack = s.ack
    LaunchedEffect(ack) {
        if (ack is AckState.Error) {
            val r = snack.showSnackbar(ack.message, actionLabel = "再試行", duration = SnackbarDuration.Indefinite)
            if (r == SnackbarResult.ActionPerformed) vm.acknowledge(id) else vm.clearAckError()
        }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("連絡の詳細") },
                navigationIcon = { IconButton(onClick = vm::back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") } },
            )
        },
        snackbarHost = { SnackbarHost(snack) },
    ) { pad ->
        if (d == null) {
            Box(Modifier.padding(pad).fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(if (s.loaded) "この連絡は見つかりません" else "読み込み中…")
            }
            return@Scaffold
        }
        Column(Modifier.padding(pad).fillMaxSize()) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(14.dp).background(urgencyColor(d.urgency), RoundedCornerShape(7.dp)))
                    Spacer(Modifier.width(8.dp))
                    Text(urgencyLabel(d.urgency), fontWeight = FontWeight.Bold, color = urgencyColor(d.urgency))
                    Spacer(Modifier.weight(1f))
                    Text(TimeFmt.hhmm(d.createdAt))
                }
                Text(d.title, fontSize = 22.sp, fontWeight = FontWeight.Bold, lineHeight = 30.sp)
                if (d.categories.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        d.categories.forEach { SuggestionChip(onClick = {}, label = { Text(it) }) }
                    }
                }
                Text(d.body, fontSize = 18.sp, lineHeight = 28.sp)
                if (d.actionRequired.isNotBlank()) {
                    Column(
                        Modifier.fillMaxWidth().background(Color(0xFFFFEBEE), RoundedCornerShape(8.dp))
                            .padding(14.dp)
                    ) {
                        Text("必要な対応", fontWeight = FontWeight.Bold, color = Red)
                        Spacer(Modifier.height(4.dp))
                        Text(d.actionRequired, fontSize = 18.sp, lineHeight = 26.sp)
                    }
                }
                if (d.reason.isNotBlank()) {
                    Column {
                        Text("あなたに届いた理由", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(d.reason, fontSize = 15.sp)
                    }
                }
            }
            val done = d.isAcknowledged
            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                if (done) {
                    val t = (ack as? AckState.Done)?.time ?: TimeFmt.hhmm(d.acknowledgedAt)
                    Text("確認を記録しました $t", color = Green, fontWeight = FontWeight.Bold, fontSize = 16.sp,
                        modifier = Modifier.padding(bottom = 8.dp))
                }
                Button(
                    onClick = { vm.acknowledge(d.id) },
                    enabled = !done && ack !is AckState.Sending,
                    modifier = Modifier.fillMaxWidth().height(64.dp),
                ) {
                    if (ack is AckState.Sending) CircularProgressIndicator(Modifier.size(24.dp), color = Color.White, strokeWidth = 2.dp)
                    else Text(if (done) "確認済み" else "確認しました", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
