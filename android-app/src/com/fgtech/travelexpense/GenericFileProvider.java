package com.fgtech.travelexpense;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;

public class GenericFileProvider extends ContentProvider {
    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public String getType(Uri uri) {
        return "image/jpeg";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (getContext() == null) {
            throw new FileNotFoundException("Context is null");
        }
        File cacheDir = getContext().getCacheDir();
        String path = uri.getPath();
        if (path != null && path.startsWith("/")) {
            path = path.substring(1);
        }
        File file = new File(cacheDir, path != null ? path : "captured_bill.jpg");
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_WRITE);
    }
}

