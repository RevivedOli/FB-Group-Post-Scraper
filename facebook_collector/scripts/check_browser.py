"""Offline native browser smoke test: no Facebook navigation or saved sessions."""
from playwright.sync_api import sync_playwright
import tempfile
import time

if __name__ == '__main__':
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.set_content('<title>Collector browser smoke test</title><p>offline</p>')
            assert page.title() == 'Collector browser smoke test'
            print('Chromium launch and local-page rendering passed; no Facebook access tested.')
        finally:
            browser.close()
        with tempfile.TemporaryDirectory(prefix='collector-profile-smoke-') as profile:
            context = p.chromium.launch_persistent_context(profile, headless=True)
            context.add_cookies([{'name':'collector_smoke','value':'synthetic',
                                 'domain':'example.invalid','path':'/','expires':time.time()+3600}])
            context.close()
            context = p.chromium.launch_persistent_context(profile, headless=True)
            try:
                assert any(c['name']=='collector_smoke' and c['value']=='synthetic' for c in context.cookies())
                print('Dedicated Chromium profile survived close/reopen with its synthetic cookie; no website accessed.')
            finally:
                context.close()
