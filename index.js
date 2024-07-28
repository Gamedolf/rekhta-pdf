import { writeFileSync } from 'fs';
import { PDFDocument } from 'pdf-lib';
import { createCanvas, loadImage } from 'canvas';
import fetch from 'node-fetch';

const PAGE_DATA_URL = "https://ebooksapi.rekhta.org/api_getebookpagebyid_websiteapp/?wref=from-site&pgid=";

const getImageUrl = (bookId, page) => `https://ebooksapi.rekhta.org/images/${bookId}/${page}`;

const getBookData = async (bookUrl) => {
    const response = await fetch(bookUrl);
    const html = await response.text();
    const pages = JSON.parse(html.match(/var pages = (\[(\s+".+"\s+,?)+\])/)[1]);
    const pageIds = JSON.parse(html.match(/var pageIds = (\[(\s+".+"\s+,?)+\])/)[1]);
    const bookId = html.match(/var bookId = "(.+)"/)[1];

    return { pages, pageIds, bookId }
}

const getPageData = async (pageId) => {
    const response = await fetch(PAGE_DATA_URL + pageId);
    return await response.json();
}

const renderEbookPage = async (data, imageUrl) => {
    const s = 50;

    const h = data.PageHeight > 0 ? data.PageHeight : 50 * parseInt(data.Y);
    const w = data.PageWidth > 0 ? data.PageWidth : 50 * parseInt(data.X);

    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const image = await loadImage(imageUrl);

    for (let i = 0; i < data.Sub.length; i++) {
        ctx.drawImage(
            image,
            data.Sub[i].X1 * (s + 16), data.Sub[i].Y1 * (s + 16), s, s,
            data.Sub[i].X2 * s, data.Sub[i].Y2 * s, s, s
        );
    }

    return canvas;
}

const getImageBuffer = async (bookId, page) => {
    const imageUrl = getImageUrl(bookId, page);
    const response = await fetch(imageUrl);
    const buffer = await response.buffer();
    return buffer;
}

const fetchImagesAndCreatePDF = async (bookData) => {
    const pdfDoc = await PDFDocument.create();

    for (let pageIndex = 0; pageIndex < bookData.pageIds.length; pageIndex++) {
        const page = bookData.pages[pageIndex];
        const pageId = bookData.pageIds[pageIndex];

        const imageBuffer = await getImageBuffer(bookData.bookId, page);
        const imageData = await getPageData(pageId);

        const processedCanvas = await renderEbookPage(imageData, `data:image/jpeg;base64,${imageBuffer.toString('base64')}`);
        const processedImageDataUrl = processedCanvas.toDataURL('image/jpeg');
        const processedImageBytes = await fetch(processedImageDataUrl).then(res => res.arrayBuffer());

        const image = await pdfDoc.embedJpg(processedImageBytes);

        const pdfPage = pdfDoc.addPage([processedCanvas.width, processedCanvas.height]);
        pdfPage.drawImage(image, {
            x: 0,
            y: 0,
            width: processedCanvas.width,
            height: processedCanvas.height,
        });

        console.log(`Page ${pageIndex}/${bookData.pages.length} processsed`);
    }

    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
}

const downloadPDF = async (bookUrl) => {
    const bookData = await getBookData(bookUrl);

    const pdfBytes = await fetchImagesAndCreatePDF(bookData);

    writeFileSync(`book-${bookData.bookId}.pdf`, pdfBytes);
}

const bookUrl = "https://www.rekhta.org/ebooks/allah-ke-rasool-saw-hakeem-sharafat-husain-rahimabadi-ebooks";
downloadPDF(bookUrl);