import asyncio, glob, zipfile, io
from playwright.async_api import async_playwright
D='/home/claude/pos/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx = await b.new_context(viewport={'width':1500,'height':950}, accept_downloads=True)
        pg = await ctx.new_page(); erros=[]
        pg.on('pageerror', lambda e: erros.append(str(e))); pg.on('console', lambda m: erros.append(m.text) if m.type=='error' else None)
        await pg.goto('file:///home/claude/hla-consenso/index.html')
        await pg.set_input_files('#arquivos', [D+'2026_NTVPB_51_MARLA_121126_RED_ROT_335784449_tarr.xml']+glob.glob(D+'*.xlsx'))
        await pg.wait_for_timeout(800); await pg.click('#bt-analisar'); await pg.wait_for_selector('table.placa')
        # abrir 3018 DPB1 (divergente) e liberar Assign
        await pg.click('.cel[data-chave="3018|HLA-DPB1"]'); await pg.wait_for_timeout(300)
        await pg.keyboard.press('a'); await pg.wait_for_timeout(300)
        await pg.fill('#nome-analista', 'Vinícius'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        await pg.screenshot(path='teste/i1_apos_decisao.png')
        # lote: DPB1 concordantes rejeitados -> NGSengine
        await pg.keyboard.press('Escape')
        await pg.click('button[data-aba="revisao"]'); await pg.wait_for_timeout(300)
        await pg.click('button[data-lote="engine"]'); await pg.wait_for_timeout(300)
        await pg.click('#confirmar'); await pg.wait_for_timeout(500)
        await pg.screenshot(path='teste/i2_revisao_pos_lote.png', full_page=True)
        pend = await pg.text_content('#cont-pend'); print('pendentes', pend)
        # manual: 3012 DPB1
        await pg.click('button[data-aba="placa"]'); await pg.wait_for_timeout(300)
        await pg.click('.cel[data-chave="3012|HLA-DPB1"]'); await pg.wait_for_timeout(300)
        await pg.keyboard.press('m'); await pg.fill('#man1','DPB1*05:01:01'); await pg.fill('#man2','DPB1*104:01:01'); await pg.click('#salvar-manual'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='teste/i3_manual.png')
        await pg.keyboard.press('Escape')
        # recarregar: decisões persistem?
        await pg.reload(); await pg.set_input_files('#arquivos', [D+'2026_NTVPB_51_MARLA_121126_RED_ROT_335784449_tarr.xml']+glob.glob(D+'*.xlsx'))
        await pg.wait_for_timeout(800); await pg.click('#bt-analisar'); await pg.wait_for_selector('table.placa'); await pg.wait_for_timeout(400)
        print('pendentes após recarregar', await pg.text_content('#cont-pend'))
        await pg.click('button[data-aba="exportar"]'); await pg.wait_for_timeout(300)
        async with pg.expect_download() as dl:
            await pg.click('#exp-zip'); await pg.wait_for_timeout(300)
            if await pg.query_selector('#exp-mesmo'): await pg.click('#exp-mesmo')
        d = await dl.value; path = await d.path(); print('download', d.suggested_filename)
        z = zipfile.ZipFile(path); print(z.namelist())
        for n in z.namelist():
            if 'sishla' in n:
                txt = z.read(n).decode(); lines = txt.splitlines(); print(lines[0][:200]); 
                for l in lines: 
                    if l.startswith('3018;') or l.startswith('3012;') or l.startswith('3009;'): print(l)
            if 'consenso' in n:
                for l in z.read(n).decode().splitlines():
                    if ';3018;HLA-DPB1' in l or ';3012;HLA-DPB1' in l: print(l[:260])
        await pg.click('button[data-aba="placa"]'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='teste/i4_placa.png')
        print('ERROS', erros); await b.close()
asyncio.run(main())
