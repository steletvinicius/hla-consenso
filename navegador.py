import asyncio, sys, glob
from playwright.async_api import async_playwright
D='/home/claude/pos/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--allow-file-access-from-files'])
        pg = await b.new_page(viewport={'width':1500,'height':950})
        erros=[]
        pg.on('console', lambda m: erros.append(m.text) if m.type in ('error','warning') else None)
        pg.on('pageerror', lambda e: erros.append('PAGEERROR '+str(e)))
        await pg.goto('file:///home/claude/hla-consenso/index.html')
        await pg.screenshot(path='teste/s0_inicio.png')
        await pg.set_input_files('#arquivos', [D+'2026_NTVPB_51_MARLA_121126_RED_ROT_335784449_tarr.xml']+glob.glob(D+'*.xlsx'))
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path='teste/s1_carregado.png')
        await pg.click('#bt-analisar')
        await pg.wait_for_selector('table.placa', timeout=30000)
        await pg.wait_for_timeout(500)
        await pg.screenshot(path='teste/s2_placa.png')
        await pg.keyboard.press('p')
        await pg.wait_for_timeout(500)
        await pg.screenshot(path='teste/s3_painel.png')
        await pg.keyboard.press('Escape')
        await pg.click('button[data-aba="revisao"]'); await pg.wait_for_timeout(400)
        await pg.screenshot(path='teste/s4_revisao.png', full_page=True)
        await pg.click('button[data-aba="qualidade"]'); await pg.wait_for_timeout(600)
        await pg.screenshot(path='teste/s5_qualidade.png', full_page=True)
        await pg.click('button[data-aba="exportar"]'); await pg.wait_for_timeout(400)
        await pg.screenshot(path='teste/s6_exportar.png', full_page=True)
        print('ERROS:', erros)
        await b.close()
asyncio.run(main())
