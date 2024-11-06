// This is all the imports since we are using module.
import express from 'express';
import multer from 'multer';
import path from 'path';
import mysql from 'mysql2';
import bodyParser from 'body-parser';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import flash from 'connect-flash';
import cron from 'node-cron';
import fs from 'fs';

const app = express();

// This is to upload the image file using multer where the file size is limited to 5 mb. It also only allows JPEG, JPG, and PNG.
// If any of those conditions fail, it will send an error message, otherwise it will upload to the uploads file.
const storage = multer.diskStorage({
    destination: './uploads/', 
    filename: (req, file, cb) => {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 5000000 }, 
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png/; 
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb('Error: Images Only!'); 
        }
    }
}).single('book_image'); 

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(session({
    secret: 'secret',
    resave: true,
    saveUninitialized: true
}));
app.use(flash());

// This is to create the connection to the databse in MySQL and connect it and log that it is connected in the terminal
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'LibraryManagementSystem'
});
db.connect((err) => {
    if (err) {
        throw err;
    }
    console.log('Connected to MySQL');
});

// This function is used to check if any of the books are past the due date where returned is false. If it meets any of those requirements
// it will update the neccessary tables with certain inforamtion to add the fines for overdue books.
const checkOverdueBooks = () => {
    const currentDate = new Date();
    const sqlQuery = `
        UPDATE requests 
        SET fine_due = true, 
            fine_amount = fine_amount + 5.00 
        WHERE returned = false AND due_date < ?`;
    db.query(sqlQuery, [currentDate], (error, results) => {
        if (error) {
            console.error('Error updating fines:', error);
        } else {
            console.log(`Updated fines for ${results.affectedRows} overdue requests.`);
        }
    });
};

// This schedules the function to run every day at midnight. This will check everyday to see if there are any books overdue.
cron.schedule('0 0 * * *', () => {
    console.log('Checking for overdue books...');
    checkOverdueBooks();
});

// This is to display the register page
app.get('/register', (req, res) => {
    if (req.session.loggedin) {
        res.redirect('/');
    } else {
        res.render('register', {
            success_msg: req.session.success_msg, // This passes the success message if it exists
            error_msg: req.session.error_msg // This passes the error message if it exists
        });
        req.session.error_msg = null; // This clears the error message after rendering
        req.session.success_msg = null; // This clears the success message if needed
    }
});

// This is to handle the registration request
app.post('/register', (req, res) => {
    const { first_name, last_name, email, password } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 10);
    const sql = 'INSERT INTO users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)';
    
    db.query(sql, [first_name, last_name, email, hashedPassword], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.render('register', {
                    error_msg: 'Email already in use'
                });
            }
            throw err;
        }
        req.session.success_msg = 'Registration successful! Welcome, ' + first_name;
        req.session.loggedin = true;
        req.session.first_name = first_name;
        req.session.email = email;
        res.redirect('/');
    });
});

// This is to display the login page
app.get('/login', (req, res) => {
    if (req.session.loggedin === true) {
        res.redirect('/');
    } else {
        res.render('login', {
            success_msg: req.query.success_msg, 
            error_msg: req.query.error_msg  
        });
    }
});

// This is to handle the request when the user wants to log into their account and checks their credentials.
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const sql = 'SELECT * FROM users WHERE email = ?';
    db.query(sql, [email], (err, result) => {
        if (err) throw err;
        if (result.length > 0) {
            const user = result[0];
            const isMatch = bcrypt.compareSync(password, user.password);
            if (isMatch) {
                req.session.loggedin = true;
                req.session.first_name = user.first_name;
                req.session.email = user.email;
                req.session.admin = user.isAdmin;
                req.session.success_msg = 'Login successful!';
                return res.redirect('/');
            } else {
                req.flash('error_msg', 'Incorrect email or password');
                return res.render('login', { 
                    error_msg: req.flash('error_msg'),
                    success_msg: req.flash('success_msg') 
                });
            }
        } else {
            req.flash('error_msg', 'Email not found');
            return res.render('login', { 
                error_msg: req.flash('error_msg'),
                success_msg: req.flash('success_msg') 
            });
        }
    });
});

// This is to display the entire home page for the user when they log into their account.
app.get('/', (req, res) => {
    if (req.session.loggedin) {
        const sqlQuery_Random = 'SELECT * FROM books ORDER BY RAND() LIMIT 10;';

        db.query(sqlQuery_Random, (error, results) => {
            if (error) {
                console.error('Database error:', error);
                return res.status(500).send('An error occurred');
            }

            // This passes the entire array of books to the EJS template
            if (results.length > 0) {
                results.forEach(book => {
                    if (book.book_description.length > 500) {
                        // this adds '...' if the description is too long for the view
                        book.book_description = book.book_description.substring(0, 500) + '...';
                    }
                });

                // Capture success_msg from session
                const success_msg = req.session.success_msg;
                // Clear success_msg from session
                req.session.success_msg = null;
                res.render('home', {
                    books: results,
                    first_name: req.session.first_name,
                    admin: req.session.admin,
                    success_msg: success_msg, 
                });
            } else {
                res.render('home', {
                    books: [], // Send an empty array if no books are found in the database
                    first_name: req.session.first_name,
                    admin: req.session.admin,
                    success_msg: null, // Ensure success_msg is null if no books found
                });
            }
        });
    } else {
        res.redirect('/login');
    }
});

// This is to display the books information the user wants to view
app.get('/view_book/:id', (req, res) => {
    if (req.session.loggedin) {
        // This gathers the books id from the URL
        const bookId = req.params.id; 
        const email = req.session.email;
        // Queries for the book with the specific ID
        const sqlBook = 'SELECT * FROM books WHERE id = ?'; 
        const sqlUser = 'SELECT * FROM users WHERE email = ?';
        const sqlRequest = 'SELECT * FROM requests WHERE user_email = ? AND book_id = ? AND returned = false';

        db.query(sqlBook, [bookId], (error, bookResult) => {
            if (error) {
                console.error('Database error:', error);
                return res.status(500).send('An error occurred');
            }
            db.query(sqlUser, [email], (err, userResult) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send('Database error');
                }
                db.query(sqlRequest, [email, bookId], (err, requestResult) => { 
                    if (err) {
                        console.error(err);
                        return res.status(500).send('Database error');
                    }
                    const book = bookResult[0];
                    const user = userResult[0];
                    let pending_request = false;
                    let requested = false;
                    let approved = false;
                    let returned = false;
                    let extend_counter = 0;
                    let request_id = null;
                    // Check if there is a request for this book by the user
                    if (requestResult.length > 0) {
                        const request = requestResult[0];
                        requested = request.requested || false;
                        approved = request.approved || false;
                        returned = request.returned || false;
                        request_id = request.id || null;
                        extend_counter = request.extend_counter || 0;
                        pending_request = true;
                    }
                    res.render('view_book', {
                        requested: requested,
                        approved: approved,
                        returned: returned,
                        request_id: request_id,
                        pending_request: pending_request,
                        extend_counter: extend_counter,
                        first_name: user.first_name,
                        current_email: req.session.email,
                        admin: req.session.admin,
                        book_name: book.book_name,
                        id: book.id,
                        book_description: book.book_description,
                        author: book.author,
                        isbn: book.ISBN,
                        publisher: book.publisher,
                        published_year: book.published_year,
                        book_image: book.book_image,
                        availability: book.availability,
                        category: book.category,
                    });
                });     
            });
        });
    } else {
        res.redirect('/');
    }
});

// This is for when the admin needs to approve or decline the books from the approve page
app.get('/approve_books', (req, res) => {
    if (req.session.loggedin && req.session.admin) {
        const currentPage = parseInt(req.query.page) || 1; 
        const itemsPerPage = 5; 
        const offset = (currentPage - 1) * itemsPerPage;
        const sqlQuery = `SELECT requests.*, books.book_image, books.book_name 
                          FROM requests 
                          JOIN books ON requests.book_id = books.id 
                          WHERE requests.approved = false AND requests.returned = false AND requests.requested = true
                          LIMIT ? OFFSET ?`;

        db.query(sqlQuery, [itemsPerPage, offset], (error, results) => {
            if (error) {
                console.error('Database error:', error);
                return res.status(500).send('An error occurred');
            }
            const totalItemsQuery = `SELECT COUNT(*) AS count 
                                     FROM requests 
                                     WHERE approved = false`;
            db.query(totalItemsQuery, (countError, countResult) => {
                if (countError) {
                    console.error('Database error:', countError);
                    return res.status(500).send('An error occurred');
                }
                const totalItems = countResult[0].count; 
                const totalPages = Math.ceil(totalItems / itemsPerPage); 
                const hasMorePages = totalPages > currentPage; 
                res.render('approve_books', {
                    books: results, 
                    hasMorePages: hasMorePages,
                    currentPage: currentPage, 
                    totalPages: totalPages,
                    admin: req.session.admin
                });
            });
        });
    } else {
        res.redirect('/');
    }
});

// This is for when the admin deletes a book. This is the process that will happen
app.post('/delete_book/:id', (req, res) => {
    if (req.session.loggedin && req.session.admin) {
        const { id } = req.params;
        const getBookImageQuery = 'SELECT book_image FROM books WHERE id = ?';
        db.query(getBookImageQuery, [id], (err, results) => {
            if (err) {
                console.error('Error fetching book image:', err);
                return res.status(500).send('Database error');
            }
            if (results.length > 0) {
                const bookImage = results[0].book_image; 
                const deleteBookQuery = 'DELETE FROM books WHERE id = ?';
                db.query(deleteBookQuery, [id], (deleteErr) => {
                    if (deleteErr) {
                        console.error('Error deleting book:', deleteErr);
                        return res.status(500).send('Error deleting book');
                    }
                    if (bookImage) {
                        const imagePath = `uploads/${bookImage}`;
                        fs.unlink(imagePath, (unlinkErr) => {
                            if (unlinkErr) {
                                console.error('Error deleting image file:', unlinkErr);
                            }
                        });
                    }
                    res.redirect('/');
                });
            } else {
                return res.status(404).send('Book not found');
            }
        });
    } else {
        req.redirect('/');
    }
});

// This gathers the edit book page for the specific book page
app.get('/edit_book/:id', (req, res) => {
    if (req.session.loggedin && req.session.admin) {
        const bookId = req.params.id;
        const email = req.session.email;
        const sqlQuery = 'SELECT isAdmin FROM users WHERE email = ?';

        db.query(sqlQuery, [email], (error, results) => {
            if (error) {
                console.error(error);
                res.redirect('/');
            } else if (results.length > 0 && results[0].isAdmin) {
                const bookQuery = 'SELECT * FROM books WHERE id = ?';
                db.query(bookQuery, [bookId], (err, bookResults) => {
                    if (err) {
                        res.status(404).send('Error fetching book data:', err);
                    } else if (bookResults.length > 0) {
                        const book = bookResults[0];
                        res.render('edit_book', {
                            book: book,
                            first_name: req.session.first_name,
                            admin: req.session.admin
                        });
                    } else {
                        res.status(404).send('Book not found');
                    }
                });
            } else {
                res.redirect('/');
            }
        });
    } else {
        res.redirect('/');
    }
});

// This processes the edit when the admin edits the book
app.post('/edit_book/:id', upload, async (req, res) =>  {
    if (req.session.loggedin && req.session.admin) {
        const bookId = req.params.id;
        const { book_name, book_description, author, publisher, published_year, category, isbn } = req.body;
        const bookImage = req.file ? req.file.filename : null;
        const getCurrentImageQuery = 'SELECT book_image FROM books WHERE id = ?';

        db.query(getCurrentImageQuery, [bookId], (err, result) => {
            if (err) {
                return res.status(500).send('Error fetching current book image');
            }
            const currentImage = result.length > 0 ? result[0].book_image : null;
            const sql = bookImage
                ? `UPDATE books SET book_name = ?, book_description = ?, author = ?, publisher = ?, published_year = ?, book_image = ?, category = ?, ISBN = ? WHERE id = ?`
                : `UPDATE books SET book_name = ?, book_description = ?, author = ?, publisher = ?, published_year = ?, category = ?, ISBN = ? WHERE id = ?`;

            const params = bookImage
                ? [book_name, book_description, author, publisher, published_year, bookImage, category, isbn, bookId]
                : [book_name, book_description, author, publisher, published_year, category, isbn, bookId];

            db.query(sql, params, (err, result) => {
                if (err) {
                    return res.status(500).send('Error updating book');
                }
                if (result.affectedRows > 0) {
                    if (bookImage && currentImage) {
                        const imagePath = `./uploads/${currentImage}`;
                        if (fs.existsSync(imagePath)) {
                            fs.unlink(imagePath, (err) => {
                                if (err) {
                                    return res.status(500).send('Error deleting old image');
                                }
                            });
                        }
                    }
                    res.redirect('/account');
                } else {
                    return res.status(500).send('Error updating book');
                }
            });
        });
    } else {
        res.redirect('/');
    }
});

// This is for when the admin adds a book to the library management system
app.get('/add_book', (req, res) => {
    if (req.session.loggedin && req.session.admin) {
        const email = req.session.email;
        const sqlQuery = 'SELECT isAdmin FROM users WHERE email = ?';
        db.query(sqlQuery, [email], (error, results) => {
            if (error) {
                console.error(error);
                res.redirect('/');
            } else {
                if (results.length > 0 && results[0].isAdmin) {
                    res.render('add_book', { 
                        first_name: req.session.first_name, 
                        admin: req.session.admin,
                        success_msg: req.query.success_msg 
                    });
                } else {
                    res.redirect('/');
                }
            }
        });
    } else {
        res.redirect('/');
    }
});

// This is process that happens when the book is being added to the system and adds it to the specific tables
app.post('/add_book', upload, async (req, res) => {
    if (req.session.loggedin && req.session.admin) {
        const { book_name, book_description, author, publisher, published_year, category, isbn } = req.body;
        const bookImage = req.file ? req.file.filename : null;
        const sql = `INSERT INTO books (book_name, book_description, author, publisher, published_year, book_image, category, ISBN) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

        db.query(sql, [book_name, book_description, author, publisher, published_year, bookImage, category, isbn], (err, result) => {
            if (err) {
                console.error('Error executing SQL:', err);
                return res.status(500).send('Error adding book');
            }
            if (result.affectedRows > 0) {
                return res.render('add_book', {
                    first_name: req.session.first_name, 
                    admin: req.session.admin,           
                    success_msg: 'Book added successfully!' 
                });
            } else {
                console.error('No rows affected. Insertion might have failed.');
                return res.status(500).send('Error adding book');
            }
        });
    } else {
        res.redirect('/');
    }
});

// This is for when the admin user wants to view a user profile.
app.get('/view_user/:id', (req, res) => {
    if (req.session.loggedin && req.session.admin) {
        const userId = req.params.id;
        const userQuery = 'SELECT * FROM users WHERE id = ?';
        db.query(userQuery, [userId], (err, results) => {
            if (err) {
                return res.status(500).send('Database error');
            }
            if (results.length > 0) {
                const user = results[0];
                const booksInUseQuery = `
                    SELECT COUNT(*) AS in_use_count 
                    FROM requests 
                    WHERE user_email = ? AND approved = true AND requested = false AND returned = false
                `;
                db.query(booksInUseQuery, [user.email], (error1, results1) => {
                    if (error1) {
                        return res.status(500).send('An error occurred while counting books in use.');
                    }
                    const booksInUse = results1[0].in_use_count;
                    const requestIdsQuery = `
                        SELECT id 
                        FROM requests 
                        WHERE user_email = ? AND returned = false
                    `;
                    db.query(requestIdsQuery, [user.email], (errorRequestIds, requestResults) => {
                        if (errorRequestIds) {
                            return res.status(500).send('An error occurred while fetching request IDs.');
                        }
                        const requestIds = requestResults.map(request => request.id);
                        const overdueBooksQuery = `
                            SELECT COUNT(*) AS overdue_count 
                            FROM requests 
                            WHERE user_email = ? AND fine_due = true
                        `;
                        db.query(overdueBooksQuery, [user.email], (error2, results2) => {
                            if (error2) {
                                return res.status(500).send('An error occurred while counting overdue books.');
                            }
                            const overdueBooks = results2[0].overdue_count;
                            const totalFineQuery = `
                                SELECT SUM(fine_amount) AS total_fine 
                                FROM requests 
                                WHERE user_email = ?
                            `;
                            db.query(totalFineQuery, [user.email], (error3, results3) => {
                                if (error3) {
                                    return res.status(500).send('An error occurred while calculating total fine.');
                                }
                                const totalFine = results3[0].total_fine || 0;
                                const totalBooksBorrowedQuery = `
                                    SELECT COUNT(*) AS total_borrowed 
                                    FROM requests 
                                    WHERE user_email = ? AND returned = true
                                `;
                                db.query(totalBooksBorrowedQuery, [user.email], (error4, results4) => {
                                    if (error4) {
                                        return res.status(500).send('An error occurred while counting total books borrowed.');
                                    }
                                    const totalBooksBorrowed = results4[0].total_borrowed;
                                    res.render('user_profile', {
                                        first_name: user.first_name,
                                        last_name: user.last_name,
                                        email: user.email,
                                        date_joined: user.date_joined,
                                        booksInUse: booksInUse,
                                        overdueBooks: overdueBooks,
                                        totalFine: Number(totalFine).toFixed(2), 
                                        totalBooksBorrowed: totalBooksBorrowed,
                                        requestIds: requestIds,
                                        admin: req.session.admin
                                    });
                                });
                            });
                        });
                    });
                });
            } else {
                res.status(404).send('User not found');
            }
        });
    } else {
        res.redirect('/');
    }
});

// This is for when the admin user wants to delete a user account from the system.
app.post('/delete_account/:email', (req, res) => {
    if (req.session.loggedin && req.session.admin) {
        const email = req.params.email; 
        const deleteUserQuery = 'DELETE FROM users WHERE email = ?';
        db.query(deleteUserQuery, [email], (error, results) => {
            if (error) {
                console.error('Error deleting user:', error);
                return res.status(500).send('An error occurred while deleting the account.');
            }
            if (results.affectedRows > 0) {
                res.redirect('/');
            } else {
                res.status(404).send('User not found.');
            }
        });
    } else {
        res.redirect('/');
    }
});

// This is the page for when the user wants to view their profile to change their information
app.get('/account', (req, res) => {
    if (req.session.loggedin) {
        const email = req.session.email;
        const userQuery = 'SELECT * FROM users WHERE email = ?';
        db.query(userQuery, [email], (err, results) => {
            if (err) {
                return res.status(500).send('Database error');
            }
            if (results.length > 0) {
                const user = results[0];
                const booksInUseQuery = `
                    SELECT COUNT(*) AS in_use_count 
                    FROM requests 
                    WHERE user_email = ? AND approved = true AND requested = false AND returned = false
                `;
                db.query(booksInUseQuery, [email], (error1, results1) => {
                    if (error1) {
                        return res.status(500).send('An error occurred while counting books in use.');
                    }
                    const booksInUse = results1[0].in_use_count;
                    const overdueBooksQuery = `
                        SELECT COUNT(*) AS overdue_count 
                        FROM requests 
                        WHERE user_email = ? AND fine_due = true
                    `;
                    db.query(overdueBooksQuery, [email], (error2, results2) => {
                        if (error2) {
                            return res.status(500).send('An error occurred while counting overdue books.');
                        }
                        const overdueBooks = results2[0].overdue_count;
                        const totalFineQuery = `
                            SELECT SUM(fine_amount) AS total_fine 
                            FROM requests 
                            WHERE user_email = ?
                        `;
                        db.query(totalFineQuery, [email], (error3, results3) => {
                            if (error3) {
                                return res.status(500).send('An error occurred while calculating total fine.');
                            }
                            const totalFine = results3[0].total_fine || 0; 
                            const totalBooksBorrowedQuery = `
                                SELECT COUNT(*) AS total_borrowed 
                                FROM requests 
                                WHERE user_email = ? AND returned = true
                            `;
                            db.query(totalBooksBorrowedQuery, [email], (error4, results4) => {
                                if (error4) {
                                    return res.status(500).send('An error occurred while counting total books borrowed.');
                                }
                                const totalBooksBorrowed = results4[0].total_borrowed;
                                res.render('account', {
                                    first_name: user.first_name,
                                    last_name: user.last_name,
                                    email: user.email,
                                    date_joined: user.date_joined,
                                    booksInUse: booksInUse,
                                    overdueBooks: overdueBooks,
                                    totalFine: Number(totalFine).toFixed(2), 
                                    totalBooksBorrowed: totalBooksBorrowed,
                                    admin: req.session.admin
                                });
                            });
                        });
                    });
                });
            } else {
                res.redirect('/'); // User not found, redirect to login
            }
        });
    } else {
        res.redirect('/');
    }
});

// This is to edit the accounts information if the user wants to change any information 
app.get('/edit_account', (req, res) => {
    if (req.session.loggedin) {
        const email = req.session.email;
        const query = 'SELECT * FROM users WHERE email = ?';

        db.query(query, [email], (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Database error');
            }
            if (results.length > 0) {
                // Assuming results[0] contains user data
                const user = results[0];
                // Pass all user data to the EJS file
                res.render('edit_account', {
                    first_name: user.first_name,
                    last_name: user.last_name,
                    email: user.email,
                    password: user.password,
                    admin: req.session.admin
                });
            } else {
                res.redirect('/'); // User not found, redirect to login
            }
        });
    } else {
        res.redirect('/');
    }
})

// This processes the information that gets updated in the account
app.post('/edit_account', (req, res) => {
    if (req.session.loggedin) {
        const { first_name, last_name, email, password } = req.body;
        // Check if the user provided a new password
        let hashedPassword = password;
        if (password) {
            // Hash the new password
            hashedPassword = bcrypt.hashSync(password, 10);
        }
        const currentEmail = req.session.email; // Get the email from the session
        // Update user information in the database
        const query = 'UPDATE users SET first_name = ?, last_name = ?, email = ?, password = ? WHERE email = ?';
        db.query(query, [first_name, last_name, email, hashedPassword, currentEmail], (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Database error');
            }
            // Optionally update the session with the new email
            req.session.email = email;
            // Redirect to a success page or back to the edit account page
            res.redirect('/edit_account');
        });
    } else {
        res.redirect('/');
    }
});

// This is when the user wants to search for a book in the library management system
app.get('/search', (req, res) => {
    if (req.session.loggedin) {
        const query = req.query.query || ''; // Always define query, default to an empty string
        const currentPage = parseInt(req.query.page) || 1; // Current page from query, default to 1
        const itemsPerPage = 5; // Set items per page

        // Function to render the response
        const renderResponse = (results) => {
            const totalItems = results.length; // Total items found
            const totalPages = Math.ceil(totalItems / itemsPerPage); // Total pages needed
            const hasMorePages = totalPages > currentPage;

            // Get results for current page
            const start = (currentPage - 1) * itemsPerPage;
            const paginatedResults = results.slice(start, start + itemsPerPage);

            res.render('search_book', {
                books: paginatedResults,
                hasMorePages: hasMorePages,
                currentPage: currentPage,
                totalPages: totalPages,
                first_name: req.session.first_name,
                query: query,
                user: req.session.user,
                admin: req.session.admin
            });
        };

        // Check if the query is empty
        if (!query) {
            const startQuery = 'SELECT * FROM books';
            db.query(startQuery, (error, results) => {
                if (error) {
                    console.error('Database error:', error);
                    return res.status(500).send('An error occurred');
                }
                return renderResponse(results); // Render response for all books
            });
        } else {
            // Proceed with the search query
            const sqlQuery = 'SELECT * FROM books WHERE book_name LIKE ? OR author LIKE ? OR ISBN LIKE ?';
            const searchTerm = `%${query}%`; // Prepare the search term with wildcards

            db.query(sqlQuery, [searchTerm, searchTerm, searchTerm], (error, results) => {
                if (error) {
                    console.error('Database error:', error);
                    return res.status(500).send('An error occurred');
                }

                return renderResponse(results); // Render response for search results
            });
        }
    } else {
        res.redirect('/');
    }
});

// This is for when the admin account wants to search for a user profile
app.get('/search_user', (req, res) => {
    if (req.session.loggedin && req.session.admin) {
        const query = req.query.query || ''; // Default to an empty string if no query is provided
        const currentPage = parseInt(req.query.page) || 1; // Get the current page, default to 1
        const itemsPerPage = 10; // Number of items per page
        // Function to render the response
        const renderResponse = (results) => {
            const totalItems = results.length; // Total number of results found
            const totalPages = Math.ceil(totalItems / itemsPerPage); // Calculate the total pages
            const hasMorePages = totalPages > currentPage;
            // Paginate results for the current page
            const start = (currentPage - 1) * itemsPerPage;
            const paginatedResults = results.slice(start, start + itemsPerPage);

            res.render('search_user', {
                users: paginatedResults,
                hasMorePages: hasMorePages,
                currentPage: currentPage,
                totalPages: totalPages,
                first_name: req.session.first_name,
                query: query,
                user: req.session.user,
                admin: req.session.admin
            });
        };
        // Check if the query is empty
        if (!query) {
            const startQuery = 'SELECT * FROM users';
            db.query(startQuery, (error, results) => {
                if (error) {
                    console.error('Database error:', error);
                    return res.status(500).send('An error occurred');
                }
                return renderResponse(results); // Render response for all users
            });
        } else {
            // Proceed with the search query
            const sqlQuery = 'SELECT * FROM users WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ?';
            const searchTerm = `%${query}%`; // Prepare the search term with wildcards

            db.query(sqlQuery, [searchTerm, searchTerm, searchTerm], (error, results) => {
                if (error) {
                    console.error('Database error:', error);
                    return res.status(500).send('An error occurred');
                }

                return renderResponse(results); // Render response for search results
            });
        }
    } else {
        res.redirect('/');
    }
});

// This is for when the admin needs to approve the books and this is where it handles the process for it
app.post('/request_approval', (req, res) => {
    if (req.session.loggedin) {
        const { book_id } = req.body; // Get the book ID from the form submission
        const email = req.session.email; // Assuming you are storing user email in session
        // Insert the request into the requests table, also include the current date for 'date_requested'
        const sqlInsertRequest = `INSERT INTO requests (user_email, book_id, date_requested) 
                                VALUES (?, ?, NOW())`;
        // Update query to change the availability of the book to 'reserved'
        const sqlUpdateBookAvailability = `UPDATE books SET availability = 'reserved' WHERE id = ?`;
        // Start with inserting the request
        db.query(sqlInsertRequest, [email, book_id], (insertError, insertResult) => {
            if (insertError) {
                console.error('Error inserting request:', insertError);
                return res.status(500).send('An error occurred while requesting the book.');
            }
            // If the request is successfully inserted, update the book's availability
            db.query(sqlUpdateBookAvailability, [book_id], (updateError, updateResult) => {
                if (updateError) {
                    console.error('Error updating book availability:', updateError);
                    return res.status(500).send('An error occurred while updating book availability.');
                }
                // Redirect to the book details page after successful request and update
                res.redirect('/view_book/' + book_id);
            });
        });
    } else {
        res.redirect('/');
    }
});

// This is process for completing the request of approving the book
app.post('/approve_request/:book_id', (req, res) => {
    if (req.session.loggedin && req.session.admin) {
        const bookId = req.params.book_id;
        const user_email = req.body.user_email;
        const dateApproved = new Date();
        const dueDate = new Date();

        const sqlQuery = 'SELECT * FROM requests WHERE book_id = ? AND approved = false AND requested = true';
        const sqlUpdateBook = 'UPDATE books SET availability = ? WHERE id = ?';
        const sqlUpdateRequest = `UPDATE requests 
                                SET approved = ?, requested = ?, date_approved = ?, due_date = ?
                                WHERE book_id = ? AND user_email = ?`;
        
        dueDate.setDate(dueDate.getDate() + 14); 

        db.query(sqlUpdateBook, ['checked_out', bookId], (errBook, resultBook) => {
            if (errBook) {
                console.error('Error updating book availability:', errBook);
                return res.status(500).send('An error occurred while approving the request.');
            }

            db.query(sqlQuery, [bookId], (errBook, resultQuery) => {
                if (errBook) {
                    console.error('Error updating book availability:', errBook);
                    return res.status(500).send('An error occurred while approving the request.');
                }

                if (resultQuery.length > 0) {
                    const request = resultQuery[0];  // Get the first request from the result
                    const user_email = request.user_email;
                    db.query(sqlUpdateRequest, [true, false, dateApproved, dueDate, bookId, user_email], (errRequest, resultRequest) => {
                        if (errRequest) {
                            console.error('Error updating request table:', errRequest);
                            return res.status(500).send('An error occurred while approving the request.');
                        }
                        res.redirect('/approve_books');
                    });
                }
            });
        });
    } else {
        res.redirect('/');
    }
});

// This is the process for declining the request of the book when the user requests it
app.post('/decline_request/:book_id', (req, res) => {
    if (req.session.loggedin && req.session.admin) {
        const bookId = req.params.book_id;
        const user_email = req.body.user_email;
        const sqlDeleteRequest = 'DELETE FROM requests WHERE book_id = ? AND user_email = ? AND requested = true AND returned = false';
        const sqlUpdateBook = 'UPDATE books SET availability = ? WHERE id = ?';

        db.query(sqlDeleteRequest, [bookId, user_email], (errRequest, resultRequest) => {
            if (errRequest) {
                console.error('Error deleting request:', errRequest);
                return res.status(500).send('An error occurred while declining the request.');
            }
            // Update book availability
            db.query(sqlUpdateBook, ['available', bookId], (errBook, resultBook) => {
                if (errBook) {
                    console.error('Error updating book availability:', errBook);
                    return res.status(500).send('An error occurred while declining the request.');
                }
                res.redirect('back');
            });
        });
    } else {
        res.redirect('/');
    }
});

// This is to view all the books the user has borrowed from the library management system.
app.get('/borrowed_books', (req, res) => {
    if (req.session.loggedin) {
        const email = req.session.email; // Get the logged-in user's email
        const query = req.query.query || ''; // Search query if needed
        const currentPage = parseInt(req.query.page) || 1; // Current page
        const itemsPerPage = 5; // Number of items per page
        // Calculate the OFFSET for SQL query (items to skip)
        const offset = (currentPage - 1) * itemsPerPage;
        // SQL query to get the paginated results for the logged-in user
        const sqlQuery = `SELECT requests.*, books.book_image, books.book_name,
                          CASE WHEN requests.due_date < NOW() AND requests.returned = false THEN true ELSE false END AS overdue
                          FROM requests 
                          JOIN books ON requests.book_id = books.id 
                          WHERE requests.approved = true AND requests.user_email = ? 
                          LIMIT ? OFFSET ?`;
        // Execute the query for fetching the paginated results
        db.query(sqlQuery, [email, itemsPerPage, offset], (error, results) => {
            if (error) {
                console.error('Database error:', error);
                return res.status(500).send('An error occurred');
            }
            // Separate query to get the total count of approved requests for the logged-in user
            const totalItemsQuery = `SELECT COUNT(*) AS count 
                                     FROM requests 
                                     WHERE approved = true AND user_email = ?`;

            // Execute the total items query to calculate pagination details
            db.query(totalItemsQuery, [email], (countError, countResult) => {
                if (countError) {
                    console.error('Database error:', countError);
                    return res.status(500).send('An error occurred');
                }

                const totalItems = countResult[0].count; // Total items found
                const totalPages = Math.ceil(totalItems / itemsPerPage); // Calculate total pages
                const hasMorePages = totalPages > currentPage; // Check if there are more pages

                // Render the page with the required data
                res.render('borrowed_books', {
                    books: results, // The paginated results
                    hasMorePages: hasMorePages, // Whether more pages exist
                    currentPage: currentPage, // Current page
                    totalPages: totalPages, // Total number of pages
                    first_name: req.session.first_name, // User first name
                    query: query, 
                    admin: req.session.admin,
                    user: req.session.user // Pass user info for admin checks
                });
            });
        });
    } else {
        res.redirect('/');
    }
});

// This is the process for when the user requests to extend the date they have the book
app.post('/extend_date', (req, res) => {
    if (req.session.loggedin) {
        const requestId = req.body.request_id;
        const bookId = req.body.book_id;
        // SQL query to increment the extend_counter and add 3 days to the due_date
        const sqlQuery = `
            UPDATE requests 
            SET extend_counter = extend_counter + 1, 
                due_date = DATE_ADD(due_date, INTERVAL 3 DAY) 
            WHERE id = ? AND extend_counter < 3`;

        db.query(sqlQuery, [requestId], (err, result) => {
            if (err) {
                console.error('Error updating extend_counter or due_date:', err);
                return res.status(500).send('An error occurred while extending the date.');
            }
            res.redirect('/view_book/' + bookId); 
        });
    } else {
        res.redirect('/');
    }
});

// This is to view all the returned books from the user that the admin views.
app.get('/returned_books', (req, res) => {
    if (req.session.loggedin && req.session.admin) {
        const requestId = req.query.request_id;
        const user_email = req.query.user_email;
        const currentPage = parseInt(req.query.page) || 1; 
        const itemsPerPage = 5; 
        const offset = (currentPage - 1) * itemsPerPage;
        const sqlQuery = `SELECT requests.*, books.book_image, books.book_name,
                            CASE WHEN requests.due_date < NOW() AND requests.returned = false THEN true ELSE false END AS overdue
                            FROM requests 
                            JOIN books ON requests.book_id = books.id 
                            WHERE requests.user_email = ? AND requests.returned = false
                            LIMIT ? OFFSET ?`;

        db.query(sqlQuery, [user_email, itemsPerPage, offset], (error, results) => {
            if (error) {
                console.error('Database error:', error);
                return res.status(500).send('An error occurred');
            }
            const totalItemsQuery = `SELECT COUNT(*) AS count 
                                     FROM requests 
                                     WHERE approved = true AND user_email = ?`;

            // Execute the total items query to calculate pagination details
            db.query(totalItemsQuery, [user_email], (countError, countResult) => {
                if (countError) {
                    console.error('Database error:', countError);
                    return res.status(500).send('An error occurred');
                }

                const totalItems = countResult[0].count; // Total items found
                const totalPages = Math.ceil(totalItems / itemsPerPage); // Calculate total pages
                const hasMorePages = totalPages > currentPage; // Check if there are more pages

                // Render the page with the required data
                res.render('return_books', {
                    books: results, 
                    hasMorePages: hasMorePages, // Whether more pages exist
                    currentPage: currentPage, // Current page
                    totalPages: totalPages, // Total number of pages
                    first_name: req.session.first_name, // User first name
                    admin: req.session.admin,
                    user_email: user_email
                });
            });
        });
    } else {
        res.redirect('/');
    }
});

// This handles the process for when the user clicked the extend date
app.post('/extend_date', (req, res) => {
    if (req.session.loggedin) {
        const requestId = req.body.request_id;
        const bookId = req.body.book_id;
        // SQL query to increment the extend_counter and add 3 days to the due_date
        const sqlQuery = `
            UPDATE requests 
            SET extend_counter = extend_counter + 1, 
                due_date = DATE_ADD(due_date, INTERVAL 3 DAY) 
            WHERE id = ? AND extend_counter < 3`;

        db.query(sqlQuery, [requestId], (err, result) => {
            if (err) {
                console.error('Error updating extend_counter or due_date:', err);
                return res.status(500).send('An error occurred while extending the date.');
            }
            res.redirect('/view_book/' + bookId); 
        });
    } else {
        res.redirect('/');
    }
});

// This is the process the admin user uses when the client has paid their book fee.
app.post('/process_paid', (req, res) => {
    if (req.session.loggedin && req.session.admin) {
        const bookId = req.body.book_id; // The book ID passed in the form
        const user_email = req.body.user_email; // The user email passed in the form
        // SQL query to get the request ID based on book ID and user email
        const getEmailQuery = `
            SELECT * 
            FROM requests 
            WHERE book_id = ? AND user_email = ? AND returned = False
        `;
        db.query(getEmailQuery, [bookId, user_email], (err, results) => {
            if (err) {
                console.error('Error fetching request ID:', err);
                return res.status(500).send('Database error occurred while fetching request ID.');
            }
            if (results.length > 0) {
                const requestId = results[0].id; // Get the request ID
                // SQL query to update the request, setting paid to true, fine_due to false, and fine_amount to 0.00
                const updateQuery = `
                    UPDATE requests
                    SET paid = true, fine_due = false, fine_amount = 0.00
                    WHERE user_email = ? AND id = ?
                `;

                // Execute the update query
                db.query(updateQuery, [user_email, requestId], (err, result) => {
                    if (err) {
                        console.error('Error processing payment:', err);
                        return res.status(500).send('Database error occurred while processing payment.');
                    }
                    if (result.affectedRows > 0) {
                        // Redirect or send a success message
                        res.redirect('back');
                    } else {
                        res.status(404).send('No matching request found or update failed.');
                    }
                });
            } else {
                res.status(404).send('No matching request found.');
            }
        });
    } else {
        res.redirect('/');
    }
});

// This is the process the admin user uses when the client has returned their book to them
app.post('/process_return', (req, res) => {
    if (req.session.loggedin && req.session.admin) {
        const bookId = req.body.book_id; 
        const user_email = req.body.user_email; 

        // SQL query to get the request ID based on book ID and user email
        const getEmailQuery = `
            SELECT * 
            FROM requests 
            WHERE book_id = ? AND user_email = ? AND returned = False
        `;

        db.query(getEmailQuery, [bookId, user_email], (err, results) => {
            if (err) {
                console.error('Error fetching request ID:', err);
                return res.status(500).send('Database error occurred while fetching request ID.');
            }

            if (results.length > 0) {
                const requestId = results[0].id; // Get the request ID

                // SQL query to update the request, setting paid to true, fine_due to false, and fine_amount to 0.00
                const updateQuery = `
                        UPDATE requests AS r
                        JOIN books AS b ON r.book_id = b.id
                        SET r.returned = true, 
                            r.approved = false,
                            r.date_returned = NOW(), 
                            b.availability = 'available'
                        WHERE r.id = ? AND b.id = ?;
                    `;

                // Execute the update query
                db.query(updateQuery, [requestId, bookId], (err, result) => {
                    if (err) {
                        console.error('Error processing payment:', err);
                        return res.status(500).send('Database error occurred while processing payment.');
                    }

                    if (result.affectedRows > 0) {
                        // Redirect or send a success message
                        res.redirect('back');
                    } else {
                        res.status(404).send('No matching request found or update failed.');
                    }
                });
            } else {
                res.status(404).send('No matching request found.');
            }
        });
    } else {
        res.redirect('/');
    }
});

// This is when the user wants to logout of their account on the website
app.post('/logout', (req, res) => {
    // Destroy the user session
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).send('An error occurred while logging out.');
        }
        res.redirect('/login'); 
    });
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
