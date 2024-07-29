#!/usr/bin/env node
import { createCanvas, loadImage } from 'canvas';
import { writeFile } from 'fs';
import fetch from 'node-fetch';
import { PDFDocument } from 'pdf-lib';
import { stdout } from 'process';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const PROCESSING_DATA_URL = "https://ebooksapi.rekhta.org/api_getebookpagebyid_websiteapp/?wref=from-site&pgid=";
const percentageFormatter = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2, minimumFractionDigits: 2 });

const writeProgress = (start, end, elapsed, percentage) => {
    if (percentage === 1) {
        stdout.cursorTo(0);
        stdout.write(`Page ${start}/${end} (${percentageFormatter.format(percentage)}) downloaded.\n`);
        return;
    }

    const total = elapsed / percentage;

    const remaining = total - elapsed;

    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor(Math.floor(remaining % 3600) / 60);
    const seconds = Math.floor(remaining % 60);

    const hh = String(hours).padStart(2, 0);
    const mm = String(minutes).padStart(2, 0);
    const ss = String(seconds).padStart(2, 0);

    stdout.cursorTo(0);
    stdout.write(`Page ${start}/${end} (${percentageFormatter.format(percentage)}) downloaded. ${hh}:${mm}:${ss} remaining`);
}

const getImageUrl = (bookId, page) => `https://ebooksapi.rekhta.org/images/${bookId}/${page}`;

const fetchBookData = async (bookUrl) => {
    const response = await fetch(bookUrl);
    const html = await response.text();

    try {
        const pages = JSON.parse(html.match(/var pages = (\[(\s+".+"\s+,?)+\])/)[1]);
        const pageIds = JSON.parse(html.match(/var pageIds = (\[(\s+".+"\s+,?)+\])/)[1]);
        const bookId = html.match(/var bookId = "(.+)"/)[1];
    
        return { pages, pageIds, bookId }
    } catch (err) {
        throw new Error("Invalid url. You must use a book url from rekhta.org");
    }
}

const fetchProcessingData = async (pageId) => {
    const response = await fetch(PROCESSING_DATA_URL + pageId);

    return await response.json();
}

const renderCanvas = async (data, imageUrl) => {
    const s = 50;

    const h = data.PageHeight > 0 ? data.PageHeight : 50 * parseInt(data.Y);
    const w = data.PageWidth > 0 ? data.PageWidth : 50 * parseInt(data.X);

    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const image = await loadImage(imageUrl);

    for (const { X1, X2, Y1, Y2 } of data.Sub) {
        ctx.drawImage(
            image,
            X1 * (s + 16), Y1 * (s + 16), s, s,
            X2 * s, Y2 * s, s, s
        );
    }

    return canvas;
}

const getImageBuffer = async (bookId, page) => {
    const imageUrl = getImageUrl(bookId, page);
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();

    return Buffer.from(buffer);
}

const fetchImagesAndCreatePDF = async (bookData) => {
    const pdfDoc = await PDFDocument.create();

    const startTime = new Date();

    for (let pageNumber = 1; pageNumber <= bookData.pageIds.length; pageNumber++) {
        const page = bookData.pages[pageNumber - 1];
        const pageId = bookData.pageIds[pageNumber - 1];

        const imageBuffer = await getImageBuffer(bookData.bookId, page);
        const imageData = await fetchProcessingData(pageId);

        const canvas = await renderCanvas(imageData, `data:image/jpeg;base64,${imageBuffer.toString('base64')}`);
        const imageDataUrl = canvas.toDataURL('image/jpeg');
        const imageBytes = await fetch(imageDataUrl).then(res => res.arrayBuffer());

        const image = await pdfDoc.embedJpg(imageBytes);

        const pdfPage = pdfDoc.addPage([canvas.width, canvas.height]);
        pdfPage.drawImage(image, {
            x: 0,
            y: 0,
            width: canvas.width,
            height: canvas.height,
        });

        writeProgress(pageNumber, bookData.pageIds.length, (new Date() - startTime) / 1000, pageNumber / bookData.pages.length);
    }

    const pdfBytes = await pdfDoc.save();

    return pdfBytes;
}

const downloadPDF = async (bookUrl) => {
    try {
        const bookData = await fetchBookData(bookUrl);
        const pdfBytes = await fetchImagesAndCreatePDF(bookData);

        writeFile(`book-${bookData.bookId}.pdf`, pdfBytes, (err) => {
            if (err) {
                console.log("Error saving");
                console.error(err);
            } else {
                console.log("File saved successfully");
            }
        });
    } catch (err) {
        console.error(err);
    }
}

const options = yargs(hideBin(process.argv))
    .usage("Usage: --url <book-url>")
    .option("url", {
        describe: "Url of the rekhta E-book you wish to download",
        type: "string",
        demandOption: true,
        coerce: (arg) => {
            try {
                const url = new URL(arg);
                if (url.origin.slice(-10) != "rekhta.org") {
                    throw new Error("Invalid url. You must use a book url from rekhta.org");
                }

                if (url.pathname.startsWith("/ebooks/detail/")) {
                    url.pathname = url.pathname.replace("ebooks/detail/", "ebooks/");
                }

                return url.toString();
            } catch (err) {
                throw err;
            }
        }
    })
    .argv;

downloadPDF(options.url);
