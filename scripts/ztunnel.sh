#!/usr/bin/env bash
###############################################################################
# ztunnel.sh — Full-feature TUI: discover, monitor, config Cloudflare Tunnel
# Backend: dialog (แนะนำ) หรือ whiptail (สำรอง)
#
# Repo: https://github.com/cvsz/zedge
# Path: scripts/ztunnel.sh
###############################################################################
set -uo pipefail

if command -v dialog >/dev/null 2>&1; then
  TUI="dialog"
elif command -v whiptail >/dev/null 2>&1; then
  TUI="whiptail"
else
  echo "กรุณาติดตั้ง dialog หรือ whiptail ก่อน: sudo apt install -y dialog"
  exit 1
fi

CF_BIN="cloudflared"
CF_DIR="$HOME/.cloudflared"
CF_CONFIG="$CF_DIR/config.yml"
METRICS_URL="http://127.0.0.1:20241/metrics"
TMP_LOG="/tmp/ztunnel_log.txt"
TMP_METRICS="/tmp/ztunnel_metrics.txt"

mkdir -p "$CF_DIR"

# ---------- UI wrappers ----------
show_menu() { # title prompt tag item ...
  local title="$1" prompt="$2"; shift 2
  if [[ "$TUI" == "dialog" ]]; then
    dialog --title "$title" --menu "$prompt" 18 72 12 "$@" 3>&1 1>&2 2>&3
  else
    whiptail --title "$title" --menu "$prompt" 18 72 12 "$@" 3>&1 1>&2 2>&3
  fi
}

show_msg() { # title text
  local title="$1" text="$2"
  if [[ "$TUI" == "dialog" ]]; then
    dialog --title "$title" --msgbox "$text" 16 72 3>&1 1>&2 2>&3
  else
    whiptail --title "$title" --msgbox "$text" 16 72 3>&1 1>&2 2>&3
  fi
}

show_input() { # title prompt default
  local title="$1" prompt="$2" default="$3"
  if [[ "$TUI" == "dialog" ]]; then
    dialog --title "$title" --inputbox "$prompt" 10 60 "$default" 3>&1 1>&2 2>&3
  else
    whiptail --title "$title" --inputbox "$prompt" 10 60 "$default" 3>&1 1>&2 2>&3
  fi
}

show_yesno() { # title text
  local title="$1" text="$2"
  if [[ "$TUI" == "dialog" ]]; then
    dialog --title "$title" --yesno "$text" 10 60 3>&1 1>&2 2>&3
  else
    whiptail --title "$title" --yesno "$text" 10 60 3>&1 1>&2 2>&3
  fi
  return $?
}

show_textbox() { # title file
  local title="$1" file="$2"
  if [[ "$TUI" == "dialog" ]]; then
    dialog --title "$title" --tailbox "$file" 20 75 3>&1 1>&2 2>&3
  else
    whiptail --title "$title" --textbox "$file" 20 75 3>&1 1>&2 2>&3
  fi
}

# ---------- Helpers ----------
discover_tunnels() {
  TUNNEL_LIST=()
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local id name
    id=$(awk '{print $1}' <<<"$line")
    name=$(awk '{print $2}' <<<"$line")
    [[ -z "$name" ]] && continue
    TUNNEL_LIST+=("$name" "ID: $id")
  done < <("$CF_BIN" tunnel list 2>/dev/null | tail -n +2)
  if [[ ${#TUNNEL_LIST[@]} -eq 0 ]]; then
    TUNNEL_LIST+=("(none)" "ไม่พบ tunnel")
  fi
}

# ---------- Tunnel management ----------
manage_tunnel() {
  local name="$1"
  while true; do
    local choice
    choice=$(show_menu "Tunnel: $name" "เลือกการทำงาน:" \
      "1" "ข้อมูล Tunnel" \
      "2" "ควบคุม Service (Start/Stop/Restart/Status)" \
      "3" "เพิ่ม DNS Route (hostname)" \
      "4" "ลบ DNS Route (hostname)" \
      "5" "ดู Logs" \
      "6" "ลบ Tunnel" \
      "7" "ย้อนกลับ")
    [[ -z "$choice" ]] && break

    case $choice in
      1)
        local info
        info=$("$CF_BIN" tunnel info "$name" 2>&1)
        show_msg "ข้อมูล Tunnel: $name" "$info"
        ;;
      2)
        local act
        act=$(show_menu "ควบคุม Service" "เลือก:" \
          "1" "Start" \
          "2" "Stop" \
          "3" "Restart" \
          "4" "Status")
        case $act in
          1)
            if systemctl list-unit-files 2>/dev/null | grep -q cloudflared; then
              sudo systemctl start cloudflared
              sleep 1
              show_msg "Start" "$(sudo systemctl status cloudflared --no-pager -n 5 2>&1)"
            else
              show_msg "ไม่ใช่ Service" "cloudflared ยังไม่ได้ติดตั้งเป็น systemd service"
            fi
            ;;
          2)
            if systemctl list-unit-files 2>/dev/null | grep -q cloudflared; then
              sudo systemctl stop cloudflared
              show_msg "Stop" "หยุด cloudflared เรียบร้อย"
            else
              pkill cloudflared 2>/dev/null
              show_msg "Stop" "ฆ่า process cloudflared เรียบร้อย"
            fi
            ;;
          3)
            if systemctl list-unit-files 2>/dev/null | grep -q cloudflared; then
              sudo systemctl restart cloudflared
              sleep 1
              show_msg "Restart" "$(sudo systemctl status cloudflared --no-pager -n 5 2>&1)"
            else
              show_msg "ไม่ใช่ Service" "โปรด Start / Stop แยกกัน"
            fi
            ;;
          4)
            if systemctl list-unit-files 2>/dev/null | grep -q cloudflared; then
              sudo systemctl status cloudflared --no-pager -n 10 2>&1 > "$TMP_LOG"
            else
              ps aux | grep cloudflared | grep -v grep > "$TMP_LOG" 2>/dev/null || echo "ไม่รันอยู่" > "$TMP_LOG"
            fi
            show_textbox "Status: cloudflared" "$TMP_LOG"
            ;;
        esac
        ;;
      3)
        local host svc
        host=$(show_input "เพิ่ม DNS Route" "ชื่อโดเมน (เช่น app.example.com):" "")
        [[ -z "$host" ]] && continue
        svc=$(show_input "เพิ่ม DNS Route" "Service URL (เช่น http://127.0.0.1:8089):" "http://127.0.0.1:8089")
        [[ -z "$svc" ]] && continue

        "$CF_BIN" tunnel route dns "$name" "$host" 2>&1 | tail -n 3 > "$TMP_LOG"
        show_msg "เพิ่ม DNS Route แล้ว" "$(cat "$TMP_LOG")"
        show_msg "สำคัญ" "ต้องเพิ่ม ingress rule ใน config.yml ด้วย:\n\n  - hostname: $host\n    service: $svc"
        ;;
      4)
        local host
        host=$(show_input "ลบ DNS Route" "ชื่อโดเมนที่ต้องการลบ:" "")
        [[ -z "$host" ]] && continue
        "$CF_BIN" tunnel route dns delete "$name" "$host" >/dev/null 2>&1
        show_msg "ลบ DNS Route" "ลบ $host เรียบร้อยแล้ว"
        ;;
      5)
        if systemctl list-unit-files 2>/dev/null | grep -q cloudflared; then
          sudo journalctl -u cloudflared -n 100 --no-pager 2>/dev/null > "$TMP_LOG"
        else
          tail -n 100 "$CF_DIR"/*.log 2>/dev/null > "$TMP_LOG" || echo "ไม่พบไฟล์ log" > "$TMP_LOG"
        fi
        show_textbox "Logs: cloudflared" "$TMP_LOG"
        ;;
      6)
        if show_yesno "ยืนยันลบ" "ลบ tunnel '$name' ถาวรใช่หรือไม่?"; then
          "$CF_BIN" tunnel delete "$name" 2>&1 | show_msg "ลบ Tunnel" ""
          return 0
        fi
        ;;
      7) break ;;
    esac
  done
}

create_tunnel() {
  local name
  name=$(show_input "สร้าง Tunnel ใหม่" "ตั้งชื่อ tunnel:" "")
  [[ -z "$name" ]] && return
  if show_yesno "ยืนยัน" "สร้าง tunnel '$name' บน Cloudflare?"; then
    "$CF_BIN" tunnel create "$name" 2>&1 | show_msg "สร้าง Tunnel" ""
  fi
}

delete_tunnel_menu() {
  discover_tunnels
  if [[ "${TUNNEL_LIST[0]}" == "(none)" ]]; then
    show_msg "ไม่พบ Tunnel" "ยังไม่มี tunnel ให้ลบ"
    return
  fi
  local choice
  choice=$(show_menu "ลบ Tunnel" "เลือก tunnel:" "${TUNNEL_LIST[@]}")
  [[ -z "$choice" || "$choice" == "(none)" ]] && return
  manage_tunnel "$choice"
}

# ---------- Metrics ----------
fetch_metrics() {
  curl -s "$METRICS_URL" 2>/dev/null > "$TMP_METRICS" || true
}

metrics_menu() {
  while true; do
    fetch_metrics
    if [[ ! -s "$TMP_METRICS" ]]; then
      show_msg "Metrics" "เข้าถึง endpoint metrics ไม่ได้:\n$METRICS_URL\n\nเริ่ม cloudflared ก่อน หรือเปิดใช้งาน metrics"
      return
    fi

    local summary
    summary=$(grep -E 'cloudflared_(tunnel|http|tcp|dns|config)' "$TMP_METRICS" | grep -v '^#' | head -20)
    if [[ -z "$summary" ]]; then
      summary="ไม่พบเมตริกของ cloudflared\nบันทึกรายละเอียดไว้ที่ $TMP_METRICS"
    fi

    local choice
    choice=$(show_menu "Metrics Monitor" "เมตริกจาก $METRICS_URL\n\n$summary" \
      "1" "รีเฟรชทันที" \
      "2" "ดูเมตริกทั้งหมด (raw)" \
      "3" "กลับ")
    case $choice in
      1) continue ;;
      2) show_textbox "Raw Metrics" "$TMP_METRICS" ;;
      3) return ;;
    esac
  done
}

# ---------- Config ----------
edit_config() {
  if [[ ! -f "$CF_CONFIG" ]]; then
    show_msg "Config" "ยังไม่มีไฟล์ config.yml ที่:\n$CF_CONFIG"
    return
  fi
  ${EDITOR:-nano} "$CF_CONFIG"
}

# ---------- Service ----------
service_menu() {
  local act
  act=$(show_menu "ควบคุม Service cloudflared" "เลือก:" \
    "1" "Start" \
    "2" "Stop" \
    "3" "Restart" \
    "4" "Status" \
    "5" "เปิดใช้งานเมื่อบูต (Enable)")
  case $act in
    1) sudo systemctl start cloudflared 2>&1 | tail -n 5 | show_msg "Start" "" ;;
    2) sudo systemctl stop cloudflared 2>&1 | tail -n 5 | show_msg "Stop" "" ;;
    3) sudo systemctl restart cloudflared 2>&1 | tail -n 5 | show_msg "Restart" "" ;;
    4)
      sudo systemctl status cloudflared --no-pager -n 15 2>&1 > "$TMP_LOG"
      show_textbox "Service Status" "$TMP_LOG"
      ;;
    5)
      sudo systemctl enable cloudflared && show_msg "Enable" "cloudflared จะเริ่มอัตโนมัติเมื่อบูต"
      ;;
  esac
}

view_logs() {
  if systemctl list-unit-files 2>/dev/null | grep -q cloudflared; then
    sudo journalctl -u cloudflared -n 100 --no-pager 2>/dev/null > "$TMP_LOG"
  else
    tail -n 100 "$CF_DIR"/*.log 2>/dev/null > "$TMP_LOG" || echo "ไม่พบ log" > "$TMP_LOG"
  fi
  show_textbox "cloudflared Logs" "$TMP_LOG"
}

# ---------- Main ----------
main_menu() {
  while true; do
    discover_tunnels
    local choice
    choice=$(show_menu "Cloudflare Tunnel TUI" "เลือกเมนู:" \
      "1" "ค้นหา / แสดงรายการ Tunnel (จาก cloudflared เครื่อง)" \
      "2" "ค้นหาผ่าน Cloudflare API (ต้องใช้ Token)" \
      "3" "สร้าง Tunnel ใหม่" \
      "4" "จัดการ Tunnel ที่มีอยู่" \
      "5" "ดู Metrics แบบเรียลไทม์" \
      "6" "แก้ไขไฟล์ config.yml" \
      "7" "ควบคุม Service cloudflared" \
      "8" "ดู Logs" \
      "9" "ออก")
    [[ -z "$choice" ]] && break

    case $choice in
      1)
        if [[ "${TUNNEL_LIST[0]}" == "(none)" ]]; then
          show_msg "ค้นหา Tunnel" "ไม่พบ tunnel ในเครื่อง"
        else
          local out=""
          local i
          for ((i=0; i<${#TUNNEL_LIST[@]}; i+=2)); do
            out+="${TUNNEL_LIST[$i]} - ${TUNNEL_LIST[$i+1]}\n"
          done
          show_msg "Tunnel ที่พบ" "$out"
        fi
        ;;
      2)
        local token account
        token=$(show_input "Cloudflare API" "ใส่ API Token (ข้ามได้):" "")
        [[ -z "$token" ]] && continue
        account=$(show_input "Cloudflare API" "ใส่ Account ID:" "")
        [[ -z "$account" ]] && continue

        local data
        data=$(curl -s -H "Authorization: Bearer $token" \
          "https://api.cloudflare.com/client/v4/accounts/$account/tunnels/v2" 2>/dev/null)

        if echo "$data" | jq -e '.success == true' >/dev/null 2>&1; then
          echo "$data" | jq -r '.result.tunnels[].name' > "$TMP_LOG"
          show_msg "พบจาก API" "$(cat "$TMP_LOG")"
        else
          show_msg "ข้อผิดพลาด API" "ดึงข้อมูลไม่สำเร็จ ตรวจสอบ Token / Account ID"
        fi
        ;;
      3) create_tunnel ;;
      4)
        if [[ "${TUNNEL_LIST[0]}" == "(none)" ]]; then
          show_msg "ไม่มี Tunnel" "ไม่มีอะไรให้จัดการ"
        else
          local tname
          tname=$(show_menu "เลือก Tunnel" "เลือก tunnel ที่ต้องการจัดการ:" "${TUNNEL_LIST[@]}")
          [[ -z "$tname" || "$tname" == "(none)" ]] && continue
          manage_tunnel "$tname"
        fi
        ;;
      5) metrics_menu ;;
      6) edit_config ;;
      7) service_menu ;;
      8) view_logs ;;
      9) break ;;
    esac
  done
}

main_menu