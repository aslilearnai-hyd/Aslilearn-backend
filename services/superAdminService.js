import User from '../models/User.js';
import Video from '../models/Video.js';
import Teacher from '../models/Teacher.js';
import Assessment from '../models/Assessment.js';

// Service functions for Super Admin operations

export const getPlatformStats = async () => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTeachers = await Teacher.countDocuments();
    const totalVideos = await Video.countDocuments();
    const totalAssessments = await Assessment.countDocuments();
    const totalAdmins = await User.countDocuments({ role: 'admin' });
    
    return {
      totalUsers,
      totalTeachers,
      totalVideos,
      totalAssessments,
      totalAdmins,
      superAdmins: 1,
      revenue: 0 // Revenue tracking to be implemented
    };
  } catch (error) {
    throw new Error('Failed to fetch platform statistics');
  }
};

export const getAllAdmins = async () => {
  try {
    const admins = await User.find({ role: 'admin' }).select('-password');
    return admins;
  } catch (error) {
    throw new Error('Failed to fetch admins');
  }
};

export const createAdmin = async (adminData) => {
  try {
    const { name, email, permissions } = adminData;
    
    // Check if admin already exists
    const existingAdmin = await User.findOne({ email });
    if (existingAdmin) {
      throw new Error('Admin already exists');
    }
    
    // Create new admin
    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    const newAdmin = new User({
      fullName: name,
      email,
      password: hashedPassword,
      role: 'admin',
      permissions: permissions || [],
      isActive: true
    });
    
    await newAdmin.save();
    
    return {
      id: newAdmin._id,
      name: newAdmin.fullName,
      email: newAdmin.email,
      permissions: newAdmin.permissions,
      status: 'Active',
      joinDate: newAdmin.createdAt
    };
  } catch (error) {
    throw new Error(error.message || 'Failed to create admin');
  }
};

export const updateAdmin = async (adminId, updateData) => {
  try {
    const { permissions, isActive } = updateData;
    
    const admin = await User.findByIdAndUpdate(
      adminId,
      { permissions, isActive },
      { new: true }
    );
    
    if (!admin) {
      throw new Error('Admin not found');
    }
    
    return {
      id: admin._id,
      name: admin.fullName,
      email: admin.email,
      permissions: admin.permissions,
      status: admin.isActive ? 'Active' : 'Inactive'
    };
  } catch (error) {
    throw new Error(error.message || 'Failed to update admin');
  }
};

export const getAllUsers = async () => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    return users;
  } catch (error) {
    throw new Error('Failed to fetch users');
  }
};

export const createUser = async (userData) => {
  try {
    const { name, email, role, details } = userData;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new Error('User already exists');
    }
    
    // Create new user
    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    const newUser = new User({
      fullName: name,
      email,
      password: hashedPassword,
      role: role,
      details: details,
      isActive: true
    });
    
    await newUser.save();
    
    return {
      id: newUser._id,
      name: newUser.fullName,
      email: newUser.email,
      role: newUser.role,
      details: newUser.details,
      status: 'Active',
      joinDate: newUser.createdAt
    };
  } catch (error) {
    throw new Error(error.message || 'Failed to create user');
  }
};

export const getAllCourses = async () => {
  try {
    const courses = await Video.find().populate('teacher', 'fullName').sort({ createdAt: -1 });
    return courses;
  } catch (error) {
    throw new Error('Failed to fetch courses');
  }
};

export const createCourse = async (courseData) => {
  try {
    const { title, subject, grade, board, teacher } = courseData;
    
    // Find teacher by name
    const teacherUser = await User.findOne({ fullName: teacher, role: 'teacher' });
    if (!teacherUser) {
      throw new Error('Teacher not found');
    }
    
    const newCourse = new Video({
      title: title,
      subject: subject,
      grade: grade,
      board: board,
      teacher: teacherUser._id,
      description: `${subject} course for ${grade} - ${board}`,
      isPublished: true
    });
    
    await newCourse.save();
    
    return {
      id: newCourse._id,
      title: newCourse.title,
      subject: newCourse.subject,
      grade: newCourse.grade,
      board: newCourse.board,
      teacher: teacherUser.fullName,
      status: 'Published',
      created: newCourse.createdAt
    };
  } catch (error) {
    throw new Error(error.message || 'Failed to create course');
  }
};

export const getAnalytics = async () => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTeachers = await Teacher.countDocuments();
    const totalVideos = await Video.countDocuments();
    
    // Calculate real analytics from database
    // TODO: Implement real analytics calculations based on user sessions and activity
    const dailyActive = 0; // To be calculated from UserSession model
    const weeklyActive = 0; // To be calculated from UserSession model
    const monthlyActive = 0; // To be calculated from UserSession model
    
    return {
      dailyActive,
      weeklyActive,
      monthlyActive,
      avgSessionTime: "0m 0s", // To be calculated from real session data
      completionRate: 0, // To be calculated from real completion data
      revenueGrowth: 0, // To be calculated from real revenue data
      userGrowth: 0, // To be calculated from real user growth data
      courseEngagement: 0 // To be calculated from real engagement data
    };
  } catch (error) {
    throw new Error('Failed to fetch analytics');
  }
};

export const getSubscriptions = async () => {
  try {
    // Mock subscription data for now
    const subscriptions = [
      { id: 1, user: "Rahul Sharma", plan: "Premium", amount: 999, status: "Active", nextBilling: "2024-09-15", paymentMethod: "Credit Card" },
      { id: 2, user: "Amit Kumar", plan: "Basic", amount: 499, status: "Active", nextBilling: "2024-09-20", paymentMethod: "UPI" },
      { id: 3, user: "Kavya Reddy", plan: "Premium", amount: 999, status: "Cancelled", nextBilling: "-", paymentMethod: "Net Banking" },
      { id: 4, user: "Arjun Patel", plan: "Pro", amount: 1499, status: "Active", nextBilling: "2024-09-18", paymentMethod: "Debit Card" },
      { id: 5, user: "Sneha Jain", plan: "Basic", amount: 499, status: "Pending", nextBilling: "2024-09-12", paymentMethod: "UPI" }
    ];
    
    return subscriptions;
  } catch (error) {
    throw new Error('Failed to fetch subscriptions');
  }
};

export const exportAllData = async () => {
  try {
    const users = await User.find().select('-password');
    const videos = await Video.find();
    const teachers = await Teacher.find();
    
    return {
      users: users,
      videos: videos,
      teachers: teachers,
      exportDate: new Date().toISOString()
    };
  } catch (error) {
    throw new Error('Failed to export data');
  }
};








