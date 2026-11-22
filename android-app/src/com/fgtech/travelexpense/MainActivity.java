package com.fgtech.travelexpense;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.Toast;

import java.io.File;

public class MainActivity extends Activity {

    public static final String APP_URL = "https://travelexpense-52gp.onrender.com";
    private static final int FILE_CHOOSER_REQUEST_CODE = 2001;
    private static final int PERMISSIONS_REQUEST_CODE = 2002;

    private WebView mWebView;
    private ProgressBar mProgressBar;
    private View mSplashLayout;
    private View mErrorLayout;
    private Button mRetryBtn;

    private ValueCallback<Uri[]> mFilePathCallback;
    private Uri mCameraPhotoUri;
    private long mLastBackPressTime = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        mWebView = findViewById(R.id.webView);
        mProgressBar = findViewById(R.id.progressBar);
        mSplashLayout = findViewById(R.id.splashLayout);
        mErrorLayout = findViewById(R.id.errorLayout);
        mRetryBtn = findViewById(R.id.retryBtn);

        mRetryBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                mErrorLayout.setVisibility(View.GONE);
                mSplashLayout.setVisibility(View.VISIBLE);
                mWebView.loadUrl(APP_URL);
            }
        });

        setupWebView();

        if (savedInstanceState == null) {
            mWebView.loadUrl(APP_URL);
        } else {
            mWebView.restoreState(savedInstanceState);
        }
    }

    private void setupWebView() {
        WebSettings settings = mWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            CookieManager.getInstance().setAcceptThirdPartyCookies(mWebView, true);
        }
        CookieManager.getInstance().setAcceptCookie(true);

        // Mobile Chrome User-Agent ensuring zero auth/oauth blocks
        String originalUa = settings.getUserAgentString();
        String mobileUa = originalUa.replace("; wv", "").replace("Version/4.0 ", "") + " FGTechMobile/1.0";
        settings.setUserAgentString(mobileUa);

        mWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress < 100) {
                    mProgressBar.setVisibility(View.VISIBLE);
                    mProgressBar.setProgress(newProgress);
                } else {
                    mProgressBar.setVisibility(View.GONE);
                    if (mSplashLayout.getVisibility() == View.VISIBLE) {
                        mSplashLayout.setVisibility(View.GONE);
                    }
                }
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (mFilePathCallback != null) {
                    mFilePathCallback.onReceiveValue(null);
                    mFilePathCallback = null;
                }
                mFilePathCallback = filePathCallback;

                launchFileChooser();
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    request.grant(request.getResources());
                }
            }
        });

        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && request != null) {
                    return handleUrl(request.getUrl().toString());
                }
                return false;
            }

            private boolean handleUrl(String url) {
                if (url == null) return false;
                if (url.startsWith("tel:") || url.startsWith("mailto:") || url.startsWith("sms:") || url.startsWith("whatsapp:") || url.startsWith("intent:")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                    } catch (Exception e) {
                        // ignore if no handler
                    }
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                mProgressBar.setVisibility(View.GONE);
                mSplashLayout.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                if (failingUrl != null && (failingUrl.contains("travelexpense") || failingUrl.equals(APP_URL))) {
                    mSplashLayout.setVisibility(View.GONE);
                    mErrorLayout.setVisibility(View.VISIBLE);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && request != null && request.isForMainFrame()) {
                    mSplashLayout.setVisibility(View.GONE);
                    mErrorLayout.setVisibility(View.VISIBLE);
                }
            }
        });

        mWebView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setData(Uri.parse(url));
                    startActivity(intent);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Downloading file...", Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private void launchFileChooser() {
        Intent takePictureIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        File photoFile = null;
        try {
            File cacheDir = getCacheDir();
            photoFile = File.createTempFile("bill_receipt_", ".jpg", cacheDir);
            mCameraPhotoUri = Uri.parse("content://com.fgtech.travelexpense.fileprovider/" + photoFile.getName());
            takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT, mCameraPhotoUri);
            takePictureIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ex) {
            photoFile = null;
            mCameraPhotoUri = null;
        }

        Intent contentSelectionIntent = new Intent(Intent.ACTION_GET_CONTENT);
        contentSelectionIntent.addCategory(Intent.CATEGORY_OPENABLE);
        contentSelectionIntent.setType("image/*");

        Intent[] intentArray;
        if (photoFile != null) {
            intentArray = new Intent[]{takePictureIntent};
        } else {
            intentArray = new Intent[0];
        }

        Intent chooserIntent = new Intent(Intent.ACTION_CHOOSER);
        chooserIntent.putExtra(Intent.EXTRA_INTENT, contentSelectionIntent);
        chooserIntent.putExtra(Intent.EXTRA_TITLE, "Select Receipt / Bill Photo");
        chooserIntent.putExtra(Intent.EXTRA_INITIAL_INTENTS, intentArray);

        startActivityForResult(chooserIntent, FILE_CHOOSER_REQUEST_CODE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (mFilePathCallback == null) {
                super.onActivityResult(requestCode, resultCode, data);
                return;
            }
            Uri[] results = null;
            if (resultCode == RESULT_OK) {
                if (data != null && data.getData() != null) {
                    results = new Uri[]{ data.getData() };
                } else if (mCameraPhotoUri != null) {
                    results = new Uri[]{ mCameraPhotoUri };
                }
            }
            mFilePathCallback.onReceiveValue(results);
            mFilePathCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onBackPressed() {
        if (mErrorLayout.getVisibility() == View.VISIBLE) {
            mErrorLayout.setVisibility(View.GONE);
            mSplashLayout.setVisibility(View.VISIBLE);
            mWebView.loadUrl(APP_URL);
            return;
        }

        if (mWebView != null && mWebView.canGoBack()) {
            mWebView.goBack();
            return;
        }

        if (System.currentTimeMillis() - mLastBackPressTime < 2000) {
            super.onBackPressed();
        } else {
            mLastBackPressTime = System.currentTimeMillis();
            Toast.makeText(this, R.string.press_again_exit, Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (mWebView != null) {
            mWebView.saveState(outState);
        }
    }

    @Override
    protected void onDestroy() {
        if (mWebView != null) {
            mWebView.destroy();
        }
        super.onDestroy();
    }
}

