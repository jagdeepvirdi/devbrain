import os
import sys
import time
import json
import datetime
import urllib.request
import psycopg2

def color_to_emoji(hex_color):
    if not hex_color:
        return "⚪"
    hex_color = hex_color.lstrip('#')
    if len(hex_color) != 6:
        return "⚪"
    try:
        r = int(hex_color[0:2], 16)
        g = int(hex_color[2:4], 16)
        b = int(hex_color[4:6], 16)
    except ValueError:
        return "⚪"
    if r > 180 and g < 100 and b < 100:
        return "🔴"
    if g > 150 and r < 100 and b < 100:
        return "🟢"
    if b > 180 and r < 100 and g < 150:
        return "🔵"
    if r > 180 and g > 120 and b < 100:
        return "🟠" if g < 160 else "🟡"
    if r > 120 and b > 120 and g < 100:
        return "🟣"
    if r > g and r > b:
        return "🔴"
    if g > r and g > b:
        return "🟢"
    if b > r and b > g:
        return "🔵"
    return "⚫"

def get_latest_session_date(fs_path):
    if not fs_path:
        return None
    sessions_dir = os.path.join(fs_path, 'sessions')
    if not os.path.isdir(sessions_dir):
        return None
    try:
        entries = os.listdir(sessions_dir)
        dates = []
        for e in entries:
            # Match folder name starting with YYYY-MM-DD
            if len(e) >= 10 and e[4] == '-' and e[7] == '-':
                dates.append(e[:10])
        if dates:
            return max(dates)
    except Exception:
        pass
    return None

def generate_digest(conn):
    with conn.cursor() as cur:
        # Fetch active projects
        cur.execute("SELECT id, name, color, fs_path FROM projects WHERE status = 'active'")
        projects = cur.fetchall()
        
        digest_lines = ["📋 *DevBrain Daily Digest*\n"]
        
        for p_id, p_name, p_color, fs_path in projects:
            # 1. Get open issues
            cur.execute("""
                SELECT COUNT(*)::int 
                FROM issues 
                WHERE project_id = %s AND status IN ('open', 'investigating')
            """, (p_id,))
            open_count = cur.fetchone()[0]
            
            # 2. Get last activity
            cur.execute("""
                SELECT MAX(last_activity) FROM (
                    SELECT MAX(updated_at) AS last_activity FROM issues WHERE project_id = %s
                    UNION ALL
                    SELECT MAX(updated_at) AS last_activity FROM documents WHERE project_id = %s
                    UNION ALL
                    SELECT MAX(updated_at) AS last_activity FROM commands WHERE project_id = %s
                    UNION ALL
                    SELECT MAX(updated_at) AS last_activity FROM releases WHERE project_id = %s
                    UNION ALL
                    SELECT MAX(updated_at) AS last_activity FROM runbooks WHERE project_id = %s
                    UNION ALL
                    SELECT MAX(updated_at) AS last_activity FROM tasks WHERE project_id = %s
                ) AS activity
            """, [p_id] * 6)
            last_act = cur.fetchone()[0]
            
            # 3. Get last session date
            last_session = get_latest_session_date(fs_path)
            session_str = last_session if last_session else "None"
            
            # 4. Check stale
            is_stale = False
            if last_act:
                # Make naive now to compare with naive db timestamp
                delta = datetime.datetime.now() - last_act.replace(tzinfo=None)
                if delta.days > 7:
                    is_stale = True
            else:
                is_stale = True
                
            emoji = color_to_emoji(p_color)
            stale_str = " ⚠️ *[STALE]*" if is_stale else ""
            
            digest_lines.append(
                f"{emoji} *{p_name}*: {open_count} open issues, Last Session: {session_str}{stale_str}"
            )
            
        if not projects:
            digest_lines.append("No active projects found.")
            
        return "\n".join(digest_lines)

def run_digest_job():
    db_url = os.environ.get('DATABASE_URL')
    port = os.environ.get('PORT', '3001')
    if not db_url:
        print("[Digest Scheduler] DATABASE_URL env var not set")
        return
        
    try:
        conn = psycopg2.connect(db_url)
        try:
            # 1. Fetch active users
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE is_active = true")
                users = cur.fetchall()
                
            if not users:
                return
                
            # 2. Generate digest message
            body = generate_digest(conn)
            title = "DevBrain Daily Digest"
            
            # 3. Send to users
            for (user_id,) in users:
                payload = json.dumps({
                    "title": title,
                    "body": body,
                    "userId": user_id
                }).encode('utf-8')
                
                req = urllib.request.Request(
                    f"http://127.0.0.1:{port}/api/notify/send-digest",
                    data=payload,
                    headers={'Content-Type': 'application/json'}
                )
                try:
                    with urllib.request.urlopen(req) as response:
                        response.read()
                except Exception as e:
                    print(f"[Digest Scheduler] Failed to send to user {user_id}: {e}")
                    
        finally:
            conn.close()
    except Exception as e:
        print(f"[Digest Scheduler] Error running digest job: {e}")

def main():
    print("[Digest Scheduler] Background service started")
    last_run_date = ""
    
    while True:
        try:
            db_url = os.environ.get('DATABASE_URL')
            if not db_url:
                time.sleep(30)
                continue
                
            # Query settings
            conn = psycopg2.connect(db_url)
            enabled = False
            target_time = "09:00"
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT value FROM app_settings WHERE key = 'digest_settings'")
                    row = cur.fetchone()
                    if row:
                        val = row[0]
                        enabled = val.get('enabled', False)
                        target_time = val.get('time', '09:00')
            except Exception as e:
                print(f"[Digest Scheduler] DB query settings error: {e}")
            finally:
                conn.close()
                
            if enabled:
                now = datetime.datetime.now()
                today = now.strftime("%Y-%m-%d")
                
                # Parse target time hour and minute
                try:
                    target_hour, target_min = map(int, target_time.split(':'))
                except ValueError:
                    target_hour, target_min = 9, 0
                    
                if now.hour == target_hour and now.minute == target_min:
                    if last_run_date != today:
                        print(f"[Digest Scheduler] Firing digest for {today} at {target_time}")
                        run_digest_job()
                        last_run_date = today
                        
        except Exception as e:
            print(f"[Digest Scheduler] Loop error: {e}")
            
        time.sleep(30)

if __name__ == "__main__":
    main()
