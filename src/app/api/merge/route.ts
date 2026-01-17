// ⛔ IMPORTANT: Force Node.js runtime
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const compressionLevel = parseInt(formData.get("compressionLevel") as string || "0");

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No PDF files uploaded." }, { status: 400 });
    }

    // Validate compression level
    if (compressionLevel < 0 || compressionLevel > 2) {
      return NextResponse.json({ error: "Invalid compression level." }, { status: 400 });
    }

    // Merge PDFs
    const mergedPdf = await PDFDocument.create();
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await PDFDocument.load(arrayBuffer);
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      pages.forEach((page) => mergedPdf.addPage(page));
    }

    // Apply different compression strategies
    let mergedBytes: Uint8Array;
    
    if (compressionLevel === 0) {
      // No compression
      mergedBytes = await mergedPdf.save();
    } 
    else if (compressionLevel === 1) {
      // Medium compression
      mergedBytes = await mergedPdf.save({
        useObjectStreams: true,
        addDefaultPage: false,
        objectsPerTick: 50,
      });
    } 
    else {
      // High compression - Use more aggressive settings
      mergedBytes = await mergedPdf.save({
        useObjectStreams: true,
        addDefaultPage: false,
        objectsPerTick: 20,
      });
      
      // Try to optimize further by removing metadata
      const optimizedPdf = await PDFDocument.load(mergedBytes);
      optimizedPdf.setTitle("Merged PDF");
      optimizedPdf.setAuthor("PDF Merger");
      optimizedPdf.setSubject("Merged Documents");
      optimizedPdf.setKeywords(["merged", "pdf"]);
      optimizedPdf.setCreationDate(new Date());
      optimizedPdf.setModificationDate(new Date());
      
      mergedBytes = await optimizedPdf.save({
        useObjectStreams: true,
        objectsPerTick: 10,
      });
    }

    const nodeBuffer = Buffer.from(mergedBytes);

    return new NextResponse(nodeBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="merged${compressionLevel > 0 ? '_compressed' : ''}.pdf"`,
        "Content-Length": nodeBuffer.length.toString(),
        "X-Compression-Level": compressionLevel.toString(),
      },
    });

  } catch (error) {
    console.error("PDF merge error:", error);
    return NextResponse.json(
      { 
        error: "Failed to merge PDFs", 
        details: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
}