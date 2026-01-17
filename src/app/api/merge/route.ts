// ⛔ IMPORTANT: Force Node.js runtime
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

// Check if Ghostscript is available
async function isGhostscriptAvailable(): Promise<boolean> {
  try {
    await execAsync("gs --version");
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  let tempDir: string | null = null;
  let tempInputPath: string | null = null;
  let tempOutputPath: string | null = null;

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

    // Save merged PDF
    const mergedBytes = await mergedPdf.save();
    
    // If no compression requested, return immediately
    if (compressionLevel === 0) {
      return new NextResponse(Buffer.from(mergedBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="merged.pdf"',
          "Content-Length": mergedBytes.length.toString(),
        },
      });
    }

    // Create temp directory for processing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-compress-"));
    tempInputPath = path.join(tempDir, "input.pdf");
    tempOutputPath = path.join(tempDir, "output.pdf");

    // Save merged PDF to temp file
    await fs.writeFile(tempInputPath, mergedBytes);

    // Check if Ghostscript is available
    const gsAvailable = await isGhostscriptAvailable();
    
    if (!gsAvailable) {
      console.warn("Ghostscript not available, using basic compression");
      // Fallback to pdf-lib compression
      const saveOptions = compressionLevel === 1 
        ? { useObjectStreams: true, objectsPerTick: 50 }
        : { useObjectStreams: true, objectsPerTick: 20 };
      
      const compressedBytes = await mergedPdf.save(saveOptions);
      
      return new NextResponse(Buffer.from(compressedBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="merged_compressed.pdf"',
          "Content-Length": compressedBytes.length.toString(),
        },
      });
    }

    // Use Ghostscript for real compression
    let gsCommand = "";
    
    switch (compressionLevel) {
      case 1: // Medium compression (ebook quality)
        gsCommand = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 \
          -dPDFSETTINGS=/ebook \
          -dNOPAUSE -dQUIET -dBATCH \
          -sOutputFile="${tempOutputPath}" "${tempInputPath}"`;
        break;
      case 2: // High compression (screen quality - smallest)
        gsCommand = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 \
          -dPDFSETTINGS=/screen \
          -dEmbedAllFonts=true -dSubsetFonts=true -dConvertCMYKImagesToRGB=true \
          -dColorImageDownsampleType=/Bicubic -dColorImageResolution=150 \
          -dGrayImageDownsampleType=/Bicubic -dGrayImageResolution=150 \
          -dMonoImageDownsampleType=/Bicubic -dMonoImageResolution=150 \
          -dNOPAUSE -dQUIET -dBATCH \
          -sOutputFile="${tempOutputPath}" "${tempInputPath}"`;
        break;
    }

    // Execute Ghostscript command
    await execAsync(gsCommand);

    // Read compressed file
    const compressedBuffer = await fs.readFile(tempOutputPath);

    return new NextResponse(compressedBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="merged_compressed.pdf"',
        "Content-Length": compressedBuffer.length.toString(),
        "X-Compression-Method": "ghostscript",
        "X-Compression-Level": compressionLevel.toString(),
      },
    });

  } catch (error) {
    console.error("PDF compression error:", error);
    return NextResponse.json(
      { 
        error: "Failed to process PDFs", 
        details: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  } finally {
    // Cleanup temp files
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn("Cleanup error:", cleanupError);
      }
    }
  }
}