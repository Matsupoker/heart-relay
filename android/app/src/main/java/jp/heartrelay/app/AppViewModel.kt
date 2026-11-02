package jp.heartrelay.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface Screen {
    data object Settings : Screen
    data object Inbox : Screen
    data class Detail(val id: String) : Screen
}

sealed interface Check {
    data object Idle : Check
    data object Loading : Check
    data class Ok(val health: Health) : Check
    data class Error(val message: String) : Check
}

sealed interface AckState {
    data object Idle : AckState
    data object Sending : AckState
    data class Done(val time: String) : AckState
    data class Error(val message: String) : AckState
}

data class UiState(
    val screen: Screen = Screen.Settings,
    val serverUrl: String = DEFAULT_SERVER_URL,
    val check: Check = Check.Idle,
    val staff: List<Staff> = emptyList(),
    val staffLoading: Boolean = false,
    val staffError: String? = null,
    val staffId: String? = null,
    val staffName: String = "",
    val staffRole: String = "",
    val deliveries: List<Delivery> = emptyList(),
    val loaded: Boolean = false,
    val refreshing: Boolean = false,
    val inboxError: String? = null,
    val ack: AckState = AckState.Idle,
)

class Repository(private val settings: SettingsStore, val api: ApiClient) {
    suspend fun deliveries(staffId: String) = api.deliveries(staffId)
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val settings = SettingsStore(app)
    private val api = ApiClient { settings.serverUrl }
    private val repo = Repository(settings, api)
    private val notifier = Notifier(app).also { it.ensureChannel() }

    private val _state = MutableStateFlow(
        UiState(
            serverUrl = settings.serverUrl,
            staffId = settings.staffId,
            staffName = settings.staffName,
            staffRole = settings.staffRole,
            screen = if (settings.staffId != null) Screen.Inbox else Screen.Settings,
        )
    )
    val state: StateFlow<UiState> = _state.asStateFlow()

    fun onServerUrlChange(v: String) {
        _state.update { it.copy(serverUrl = v, check = Check.Idle) }
    }

    fun checkConnection() {
        val url = _state.value.serverUrl.trim()
        settings.serverUrl = url
        _state.update { it.copy(check = Check.Loading, staffError = null) }
        viewModelScope.launch {
            try {
                val h = api.health()
                _state.update { it.copy(check = Check.Ok(h), staffLoading = true) }
                val staff = api.staff().filter { it.active }
                _state.update { it.copy(staff = staff, staffLoading = false) }
            } catch (e: Exception) {
                _state.update {
                    it.copy(
                        check = if (it.check is Check.Ok) it.check else Check.Error(e.message ?: "接続エラー"),
                        staffLoading = false,
                        staffError = if (it.check is Check.Ok) (e.message ?: "職員一覧の取得に失敗") else null,
                    )
                }
            }
        }
    }

    fun selectStaff(s: Staff) {
        settings.staffId = s.id
        settings.staffName = s.name
        settings.staffRole = s.role
        _state.update {
            it.copy(
                staffId = s.id, staffName = s.name, staffRole = s.role,
                deliveries = emptyList(), loaded = false, inboxError = null,
                ack = AckState.Idle, screen = Screen.Inbox,
            )
        }
    }

    fun switchStaff() {
        _state.update { it.copy(screen = Screen.Settings, deliveries = emptyList(), loaded = false) }
        if (_state.value.staff.isEmpty()) checkConnection()
    }

    fun openDetail(id: String) {
        _state.update { it.copy(screen = Screen.Detail(id), ack = AckState.Idle) }
    }

    /** 通知タップ等から。職員未選択なら無視。 */
    fun openFromNotification(id: String) {
        if (_state.value.staffId == null) return
        openDetail(id)
        refresh(manual = false)
    }

    fun back() {
        _state.update { it.copy(screen = Screen.Inbox, ack = AckState.Idle) }
    }

    fun refresh(manual: Boolean) {
        val staffId = _state.value.staffId ?: return
        if (manual) _state.update { it.copy(refreshing = true) }
        viewModelScope.launch {
            try {
                val list = repo.deliveries(staffId)
                handleNotifications(staffId, list)
                // 取得中に職員が切り替わっていたら捨てる
                if (_state.value.staffId == staffId) {
                    _state.update { it.copy(deliveries = DeliveryLogic.sortInbox(list), loaded = true, inboxError = null, refreshing = false) }
                }
            } catch (e: Exception) {
                _state.update { it.copy(inboxError = e.message ?: "取得に失敗しました", refreshing = false) }
            }
        }
    }

    private fun handleNotifications(staffId: String, list: List<Delivery>) {
        val seen = settings.seenIds(staffId)
        if (seen == null) {
            // 初回: 既存分は既読扱いにして通知しない
            settings.setSeenIds(staffId, list.map { it.id }.toSet())
            return
        }
        val fresh = DeliveryLogic.newUnseen(list, seen)
        fresh.forEach { notifier.notify(it) }
        if (fresh.isNotEmpty() || list.any { it.id !in seen }) {
            settings.setSeenIds(staffId, seen + list.map { it.id })
        }
    }

    fun acknowledge(id: String) {
        val staffId = _state.value.staffId ?: return
        if (_state.value.ack is AckState.Sending) return
        _state.update { it.copy(ack = AckState.Sending) }
        viewModelScope.launch {
            try {
                val d = api.ack(id, staffId)
                notifier.cancel(id)
                _state.update { s ->
                    val updated = s.deliveries.map { if (it.id == d.id) d else it }
                    s.copy(
                        deliveries = DeliveryLogic.sortInbox(updated),
                        ack = AckState.Done(TimeFmt.hhmm(d.acknowledgedAt)),
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(ack = AckState.Error(e.message ?: "確認の記録に失敗しました")) }
            }
        }
    }

    fun clearAckError() {
        _state.update { if (it.ack is AckState.Error) it.copy(ack = AckState.Idle) else it }
    }
}
