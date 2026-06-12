import sys
import os
import json
import apprise

def main():
    try:
        # Read from stdin
        input_data = sys.stdin.read()
        payload = json.loads(input_data)
        
        title = payload.get('title', '')
        body = payload.get('body', '')
        level = payload.get('level', 'info') # info, success, warning, error
        apprise_urls = payload.get('apprise_urls', [])
        
        # Construct default Telegram URL if no URLs provided and ENV variables exist
        telegram_token = os.environ.get('TELEGRAM_BOT_TOKEN')
        telegram_chat_id = os.environ.get('TELEGRAM_CHAT_ID')
        if not apprise_urls and telegram_token and telegram_chat_id:
            apprise_urls = [f"tgram://{telegram_token}/{telegram_chat_id}"]
            
        if not apprise_urls:
            print(json.dumps({"sent": False, "error": "No Apprise URLs configured or provided"}))
            sys.exit(0)
            
        # Map levels to Apprise NotifyType
        notify_type = apprise.NotifyType.INFO
        if level == 'success':
            notify_type = apprise.NotifyType.SUCCESS
        elif level == 'warning':
            notify_type = apprise.NotifyType.WARNING
        elif level == 'error':
            notify_type = apprise.NotifyType.FAILURE
            
        ap = apprise.Apprise()
        for url in apprise_urls:
            ap.add(url)
            
        success = ap.notify(body=body, title=title, notify_type=notify_type)
        if success:
            print(json.dumps({"sent": True}))
        else:
            print(json.dumps({"sent": False, "error": "Failed to send notification via Apprise"}))
            
    except Exception as e:
        print(json.dumps({"sent": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
