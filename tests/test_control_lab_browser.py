from pathlib import Path
import asyncio, json
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/"control-observer-lab.html").read_text(encoding="utf-8")
SHOT=ROOT/"validation"/"control_observer_lab.png"

async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        page=await browser.new_page(viewport={"width":1440,"height":1100}, device_scale_factor=1)
        mock = """<script>(()=>{const tools={};const mc={async registerTool(tool){tools[tool.name]=tool;},async getTools(){return Object.values(tools);}};Object.defineProperty(Document.prototype,'modelContext',{configurable:true,get(){return mc;}});window.__webmcpTools=tools;})();</script>"""
        html = HTML.replace("<head>", "<head>"+mock, 1)
        await page.set_content(html, wait_until="load")
        await page.wait_for_function("document.querySelector('#webmcpBadge').textContent.includes('registered')")
        names=await page.evaluate("Object.keys(window.__webmcpTools).sort()")
        required={"cartpole_get_state","cartpole_set_controller","cartpole_set_observer","cartpole_set_scenario","cartpole_apply_push","cartpole_reset","cartpole_run_steps","cartpole_run_probe"}
        assert required.issubset(names), (required,names)
        await page.evaluate("window.__webmcpTools.cartpole_set_controller.execute({controller:'mpc'})")
        assert await page.locator("#controller").input_value()=="mpc"
        payload=json.loads(await page.evaluate("window.__webmcpTools.cartpole_run_steps.execute({steps:40})"))
        assert payload["controller"]=="mpc" and payload["t"]>0
        probe=json.loads(await page.evaluate("window.__webmcpTools.cartpole_run_probe.execute({controller:'lqr',observer:'kf',scenario:'sensor',seed:12,steps:120,pushForce:3})"))
        assert probe["controller"]=="lqr" and probe["observer"]=="kf" and probe["scenario"]=="sensor"
        overflow=await page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        assert overflow <= 1, overflow
        await page.click("#compare")
        await page.wait_for_function("document.querySelectorAll('#matrix tbody tr').length >= 4")
        rows=await page.locator("#matrix tbody tr").count()
        assert rows==4, rows
        SHOT.parent.mkdir(parents=True,exist_ok=True)
        await page.screenshot(path=str(SHOT), full_page=True)
        print(json.dumps({"webmcp_tools":names,"t_after_tool":payload["t"],"probe_rmse":probe["rmseState"],"comparison_rows":rows,"horizontal_overflow":overflow,"screenshot":str(SHOT)},ensure_ascii=False))
        await browser.close()

asyncio.run(main())
